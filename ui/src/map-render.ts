// Prototype for #407, step 1: other ways to draw the map's static layers (the animated base, the scene under the
// units and the scene over them), picked with the page's ?maprender= so they can be played and compared.
//   sprites  one Sprite per picture, culled each frame the camera moves (what the map does today; the default)
//   margin   the same sprites, culled to a rectangle 400 px bigger than the screen on each side, and culled again
//            only once the camera has moved 200 px from where it last culled, or the zoom or size changed
//   chunks   each 16x16-tile chunk's sprites drawn once into a texture (cacheAsTexture), again on a change or a zoom
//   tilemap  each chunk's pictures as one @pixi/tilemap Tilemap over a few atlas pages
// chunks and tilemap cull their live layers (units, cursor, path, overlays) as margin does: culling every frame
// over the units of a big map cost them 4 ms a frame.
// The chunks are 16x16 in the diamond grid (along the tiles' sides), not in rows and columns: a tile's picture spills
// only up and to the sides, onto tiles behind it, and diamond chunks drawn back to front keep that order.
import { type Application, Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import { POINT_STRUCT_SIZE, Tilemap, settings as tilemapSettings } from '@pixi/tilemap';
import { H, W } from './view';

export type MapRender = 'sprites' | 'margin' | 'chunks' | 'tilemap';
const RENDERS: readonly MapRender[] = ['sprites', 'margin', 'chunks', 'tilemap'];

/** The renderer the page's ?maprender= asks for; sprites, today's, when it names none. */
export function mapRender(search: string = globalThis.location?.search ?? ''): MapRender {
  const v = new URLSearchParams(search).get('maprender') as MapRender | null;
  return v && RENDERS.includes(v) ? v : 'sprites';
}

/** The page's ?mapstats: count draw calls, time the GPU and keep the chunk costs, for scripts/pan.ts. */
export const wantStats = (search: string = globalThis.location?.search ?? ''): boolean =>
  new URLSearchParams(search).has('mapstats');

export const CHUNK = 16;

/** The chunk a tile is in: tiles along the diamond grid's two axes, 16 by 16. */
export function chunkOf(x: number, y: number): [number, number] {
  const u = x + ((y + 1) >> 1);
  const v = (y >> 1) - x;
  return [Math.floor(u / CHUNK), Math.floor(v / CHUNK)];
}

type Picture = HTMLImageElement | HTMLCanvasElement;

/** What a chunk renderer has cost so far, for scripts/pan.ts (window.__mapStats). */
export const chunkStats = {
  builds: 0,
  buildMs: 0,
  buildMax: 0,
  rebleeds: 0,
  rebleedMs: 0,
  atlasBytes: 0,
  cacheBytes: 0,
  chunks: 0,
};

/** A drawing on a static layer: a picture, or some other object made when its chunk is built. */
export interface Item {
  /** What it shows and where, to tell whether a chunk changed. */
  key: string;
  pic?: Picture;
  x: number;
  y: number;
  dim: boolean;
  /** A whole tile's picture, which bleeds over its neighbours when the map is scaled between pixels. */
  tile: boolean;
  make?: () => Container;
  /** The box it covers, in map pixels. */
  box: [number, number, number, number];
  /** The chunk it is in. */
  chunk?: string;
}

interface Chunk {
  key: string;
  cu: number;
  cv: number;
  items: Item[];
  sig: string;
  container: Container;
  box: Rectangle;
  dirty: boolean;
  /** What the chunk was built with: its objects, to destroy, and its tilemaps, to reuse. */
  objects: Container[];
  maps: Tilemap[];
  cachedAt: number;
}

export interface ChunkBackend {
  build(c: Chunk): void;
  /** The chunk is well off the screen: what it holds may be let go, to build again when it comes back. */
  release(c: Chunk): void;
  /** The map's scale (times the screen's pixel ratio) changed. */
  rescale(k: number, chunks: Iterable<Chunk>): void;
}

const ids = new WeakMap<Picture, number>();
let nextId = 1;
export const picId = (p: Picture) => {
  let id = ids.get(p);
  if (!id) ids.set(p, (id = nextId++));
  return id;
};

/** One static layer, drawn per chunk. */
export class ChunkLayer {
  private chunks = new Map<string, Chunk>();
  describe() {
    const cs = [...this.chunks.values()];
    const shown = cs.filter((c) => c.container.visible);
    return {
      chunks: cs.length,
      shown: shown.length,
      items: cs.reduce((n, c) => n + c.items.length, 0),
      shownItems: shown.reduce((n, c) => n + c.items.length, 0),
      maps: shown.reduce((n, c) => n + c.maps.length, 0),
      pages: [
        ...new Set(
          shown.flatMap((c) =>
            c.maps.flatMap((m) => {
              const pb = (m as unknown as { pointsBuf: number[] }).pointsBuf;
              const t = (m as unknown as { tileset: { count: number } }).tileset.count;
              return pb.filter((_, i) => i % POINT_STRUCT_SIZE === 9).map((p) => `${p}/${t}`);
            }),
          ),
        ),
      ],
      sample: shown[0]?.maps[0]
        ? (shown[0].maps[0] as unknown as { pointsBuf: number[] }).pointsBuf.slice(0, POINT_STRUCT_SIZE)
        : [],
      dirty: cs.filter((c) => c.dirty).length,
      view: [this.view.x, this.view.y, this.view.width, this.view.height].map(Math.round),
      rootVisible: this.root.visible && !!this.root.parent,
    };
  }
  private next: Item[] | null = null;
  /** The pictures in the order they were drawn, which repicture() replaces. */
  private images: { item: Item; chunk: Chunk }[] = [];
  private view = new Rectangle();
  private keep = new Rectangle();
  constructor(
    readonly root: Container,
    private backend: ChunkBackend,
  ) {
    // The chunks cull themselves (see setView): PixiJS's culler need not walk the layer.
    root.cullableChildren = false;
  }

  begin() {
    this.next = [];
  }

  get collecting() {
    return this.next !== null;
  }

  push(tile: [number, number], item: Item) {
    const [cu, cv] = chunkOf(...tile);
    item.chunk = `${cu},${cv}`;
    this.next!.push(item);
  }

  end() {
    const items = this.next;
    this.next = null;
    if (!items) return;
    const by = new Map<string, number[]>();
    items.forEach((it, i) => {
      let l = by.get(it.chunk!);
      if (!l) by.set(it.chunk!, (l = []));
      l.push(i);
    });
    let reorder = false;
    for (const [k, c] of this.chunks)
      if (!by.has(k)) {
        this.destroy(c);
        this.chunks.delete(k);
        reorder = true;
      }
    for (const [k, at] of by) {
      const list = at.map((i) => items[i]);
      const sig = list.map((i) => i.key).join('|');
      let c = this.chunks.get(k);
      if (!c) {
        const [cu, cv] = k.split(',').map(Number);
        c = {
          key: k,
          cu,
          cv,
          items: [],
          sig: '',
          container: new Container(),
          box: new Rectangle(),
          dirty: true,
          objects: [],
          maps: [],
          cachedAt: 0,
        };
        this.chunks.set(k, c);
        reorder = true;
      }
      if (c.sig !== sig) {
        c.sig = sig;
        c.items = list;
        c.dirty = true;
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const { box } of list) {
          x0 = Math.min(x0, box[0]);
          y0 = Math.min(y0, box[1]);
          x1 = Math.max(x1, box[0] + box[2]);
          y1 = Math.max(y1, box[1] + box[3]);
        }
        c.box = new Rectangle(x0, y0, x1 - x0, y1 - y0);
      } else {
        // The same drawings: the built chunk stays, with its items, whose pictures repicture() swaps.
        const kept = c.items;
        at.forEach((i, n) => (items[i] = kept[n]));
      }
    }
    if (reorder) {
      // Back to front: a chunk further down the diagonal is in front; along a diagonal, west to east.
      const order = [...this.chunks.values()].sort(
        (a, b) => a.cu + a.cv - (b.cu + b.cv) || a.cu - a.cv - (b.cu - b.cv),
      );
      this.root.removeChildren();
      if (order.length) this.root.addChild(...order.map((c) => c.container));
    }
    // In the order they were drawn, as repicture() gets them.
    this.images = items.filter((it) => it.pic).map((item) => ({ item, chunk: this.chunks.get(item.chunk!)! }));
    chunkStats.chunks = this.chunks.size;
    this.refresh();
  }

  /** The animated base's next frame: the same pictures in the same places, but other pictures. */
  repicture(pics: Picture[]): boolean {
    if (pics.length !== this.images.length) return false;
    pics.forEach((p, i) => {
      const { item, chunk } = this.images[i];
      if (item.pic === p) return;
      item.pic = p;
      item.key = `i${picId(p)},${item.x},${item.y},${item.dim}`;
      chunk.dirty = true;
      chunk.sig = '';
    });
    for (const c of this.chunks.values()) if (c.dirty) c.sig = c.items.map((i) => i.key).join('|');
    this.refresh();
    return true;
  }

  /** What is on the screen, and what to keep built around it, in map pixels. */
  setView(view: Rectangle, keep: Rectangle) {
    this.view = view;
    this.keep = keep;
    this.refresh();
  }

  rescale(k: number) {
    this.backend.rescale(k, this.chunks.values());
    this.refresh();
  }

  private refresh() {
    for (const c of this.chunks.values()) {
      const on = c.box.intersects(this.view);
      c.container.visible = on;
      if (on && c.dirty) {
        const t = performance.now();
        this.backend.build(c);
        const ms = performance.now() - t;
        chunkStats.builds++;
        chunkStats.buildMs += ms;
        chunkStats.buildMax = Math.max(chunkStats.buildMax, ms);
        c.dirty = false;
      } else if (!on && !c.dirty && !c.box.intersects(this.keep)) {
        this.backend.release(c);
      }
    }
  }

  private destroy(c: Chunk) {
    this.backend.release(c);
    for (const o of c.objects) o.destroy();
    c.container.destroy({ children: true });
  }

  /** Every object drawn now, for counting what covers the screen. */
  visibleChunks(): Chunk[] {
    return [...this.chunks.values()].filter((c) => c.container.visible);
  }
}

function clearChunk(c: Chunk) {
  c.container.removeChildren();
  for (const o of c.objects) o.destroy();
  c.objects = [];
}

/** Atlas pages for the tilemaps: each picture once, with room round it, and whole tiles drawn with their bleed. */
const PAGE = 2048;
const PAD = 2;
interface Entry {
  page: number;
  u: number;
  v: number;
  w: number;
  h: number;
  /** Where the quad sits from the picture's place. */
  ox: number;
  oy: number;
  pic: Picture;
  tile: boolean;
}
export class Atlas {
  private pages: {
    canvas: HTMLCanvasElement;
    g: CanvasRenderingContext2D;
    texture: Texture;
    x: number;
    y: number;
    rowH: number;
    dirty: boolean;
  }[] = [];
  private entries = new Map<Picture, Entry>();
  private tileEntries = new Map<Picture, Entry>();
  private bleed = 0;

  get(pic: Picture, tile: boolean): Entry {
    const map = tile ? this.tileEntries : this.entries;
    let e = map.get(pic);
    if (e) return e;
    const [w, h] = tile ? [W + 2 * PAD, H + 2 * PAD] : [pic.width, pic.height];
    const slot = this.alloc(w + 2 * PAD, h + 2 * PAD);
    e = { ...slot, u: slot.u + PAD, v: slot.v + PAD, w, h, ox: tile ? -PAD : 0, oy: tile ? -PAD : 0, pic, tile };
    map.set(pic, e);
    this.paint(e);
    return e;
  }

  private alloc(w: number, h: number) {
    let p = this.pages.at(-1);
    if (p && p.x + w > PAGE) {
      p.x = 0;
      p.y += p.rowH;
      p.rowH = 0;
    }
    if (!p || p.y + h > PAGE) {
      const canvas = Object.assign(document.createElement('canvas'), { width: PAGE, height: PAGE });
      const g = canvas.getContext('2d')!;
      const texture = Texture.from(canvas);
      p = { canvas, g, texture, x: 0, y: 0, rowH: 0, dirty: true };
      this.pages.push(p);
      chunkStats.atlasBytes = this.pages.length * PAGE * PAGE * 4;
      if (this.pages.length > tilemapSettings.TEXTURES_PER_TILEMAP)
        console.warn(`map atlas: ${this.pages.length} pages, more than a tilemap holds`);
    }
    const at = { page: this.pages.length - 1, u: p.x, v: p.y };
    p.x += w;
    p.rowH = Math.max(p.rowH, h);
    return at;
  }

  private paint(e: Entry) {
    const p = this.pages[e.page];
    p.g.clearRect(e.u, e.v, e.w, e.h);
    if (e.tile) {
      const b = this.bleed;
      p.g.drawImage(e.pic, e.u + PAD - b / 2, e.v + PAD - b / 2, W + b, H + b);
    } else p.g.drawImage(e.pic, e.u, e.v);
    p.dirty = true;
  }

  /** The tiles' bleed changed with the map's scale: draw the whole tiles again. */
  setBleed(b: number) {
    if (b === this.bleed) return;
    this.bleed = b;
    for (const e of this.tileEntries.values()) this.paint(e);
    this.flush();
  }

  flush() {
    for (const p of this.pages)
      if (p.dirty) {
        p.dirty = false;
        p.texture.source.update();
      }
  }

  textures(): Texture[] {
    return this.pages.map((p) => p.texture);
  }
}

/**
 * A Tilemap in a render group. @pixi/tilemap 5 draws with the group's transform times the tilemap's world
 * transform, which holds the group's again: the map moved twice. Its transform within its group is what it needs.
 */
class GroupTilemap extends Tilemap {
  override get worldTransform() {
    return this.relativeGroupTransform;
  }
  /**
   * @pixi/tilemap 5 sends each tile's texture number as a 32-bit integer attribute, which WebGL 1 cannot take
   * (glVertexAttribPointer: Invalid type; nothing is drawn). The shader reads it as a float: send it as one.
   */
  override updateBuffer(plugin: Parameters<Tilemap['updateBuffer']>[0]) {
    const self = this as unknown as {
      vb: { attributes: Record<string, { format: string }>; getBuffer(n: string): { update(): void } } | null;
      vbArray: Float32Array | null;
      vbInts: Uint32Array | null;
      rects_count: number;
      pointsBuf: number[];
    };
    // The buffer is written again only when the tile count changed (clear() sets it to 0) or there is none yet.
    const rewrite = !self.vb || self.rects_count !== self.pointsBuf.length / POINT_STRUCT_SIZE;
    super.updateBuffer(plugin);
    if (!rewrite) return;
    const { vb, vbArray, vbInts } = self;
    if (!vb || !vbArray || !vbInts) return;
    const id = vb.attributes.aTextureId;
    if (id.format !== 'float32') id.format = 'float32';
    // 4 vertices a tile, 13 floats a vertex (TilemapGeometry.stride); the texture number is the 11th.
    const floats = 13;
    const n = self.rects_count * 4;
    for (let v = 0; v < n; v++) {
      const i = v * floats + 10;
      vbArray[i] = (vbInts[i] | 0) as number;
    }
    vb.getBuffer('aVertexPosition').update();
  }
  /** Where it is on the screen: its group's world transform, then its own within the group. */
  get screenTransform() {
    return this.relativeGroupTransform.clone().prepend(this.parentRenderGroup?.worldTransform ?? Matrix.IDENTITY);
  }
}

// Few samplers: each one is a branch in the fragment shader, which a weak GPU feels.
tilemapSettings.TEXTURES_PER_TILEMAP = 8;

/** Chunks as tilemaps over the atlas; what is not a picture is an object between them, in the order drawn. */
export function tilemapBackend(
  atlas: Atlas,
  dimmed: (p: Picture) => Picture,
  bleedAt: (k: number) => number,
): ChunkBackend {
  return {
    build(c) {
      clearChunk(c);
      const entries = c.items.map((it) => (it.pic ? atlas.get(it.dim ? dimmed(it.pic) : it.pic, it.tile) : null));
      atlas.flush();
      // @pixi/tilemap types the tileset as texture sources, but reads each one's .source: it takes textures.
      const textures = atlas.textures();
      let seg: Tilemap | null = null;
      let used = 0;
      c.items.forEach((it, i) => {
        const e = entries[i];
        if (e) {
          if (!seg) {
            seg = c.maps[used] ??= new GroupTilemap(textures as never);
            // A lone Tilemap draws every tile from its first texture; one in a CompositeTilemap reads each tile's.
            seg.compositeParent = true;
            used++;
            seg.clear();
            seg.setTileset(textures as never);
            c.container.addChild(seg);
          }
          seg.tile(e.page, it.x + e.ox, it.y + e.oy, { u: e.u, v: e.v, tileWidth: e.w, tileHeight: e.h });
        } else if (it.make) {
          seg = null;
          const o = it.make();
          c.objects.push(o);
          c.container.addChild(o);
        }
      });
      for (const m of c.maps.splice(used)) m.destroy();
    },
    release() {},
    rescale(k) {
      const t = performance.now();
      atlas.setBleed(bleedAt(k));
      chunkStats.rebleeds++;
      chunkStats.rebleedMs += performance.now() - t;
    },
  };
}

/** Chunks as textures: the sprites of today, drawn once into a texture at the map's scale. */
export function cacheBackend(sprite: (it: Item) => Sprite, scale: () => number): ChunkBackend {
  const bytes = (c: Chunk) => Math.ceil(c.box.width * c.cachedAt) * Math.ceil(c.box.height * c.cachedAt) * 4;
  const uncache = (c: Chunk) => {
    if (!c.cachedAt) return;
    chunkStats.cacheBytes -= bytes(c);
    c.container.cacheAsTexture(false);
    c.cachedAt = 0;
  };
  return {
    build(c) {
      uncache(c);
      clearChunk(c);
      for (const it of c.items) {
        const o = it.pic ? sprite(it) : it.make!();
        c.objects.push(o);
        c.container.addChild(o);
      }
      const k = scale();
      c.container.cacheAsTexture({ resolution: k, antialias: false });
      c.cachedAt = k;
      chunkStats.cacheBytes += bytes(c);
    },
    release(c) {
      uncache(c);
      clearChunk(c);
      c.dirty = true;
    },
    rescale(_k, chunks) {
      for (const c of chunks) c.dirty = true;
    },
  };
}

/**
 * ?mapstats: what each render costs, kept in window.__mapStats for scripts/pan.ts: the WebGL draw calls, the CPU time
 * of app.render(), the GPU's time where the browser offers a timer query, and on asking, how many times over the
 * screen's pixels a frame's pictures cover it (the GPU's fill work, transparent pixels included).
 */
export interface RenderStats {
  render(f: () => void): void;
  chunkLayers?: Map<number, ChunkLayer>;
}
export function renderStats(app: Application, textureBytes: () => number): RenderStats {
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
  const s = {
    webgl: gl ? (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 2 : 1) : 0,
    frames: 0,
    draws: [] as number[],
    cpuMs: [] as number[],
    gpuMs: [] as number[],
    gpuTimer: false,
  };
  let draws = 0;
  if (gl) {
    const g = gl as unknown as Record<string, unknown>;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = g[f] as ((...a: unknown[]) => unknown) | undefined;
      if (orig)
        g[f] = function (this: unknown, ...a: unknown[]) {
          draws++;
          return orig.apply(this, a);
        };
    }
  }
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  s.gpuTimer = !!ext;
  const pending: WebGLQuery[] = [];
  const poll = () => {
    while (gl && ext && pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) s.gpuMs.push(ns / 1e6);
      gl.deleteQuery(q);
      pending.shift();
    }
  };
  const stats: RenderStats = {
    render(f) {
      const t = performance.now();
      const q = gl && ext && !pending.length ? gl.createQuery() : null;
      if (q) gl!.beginQuery(ext!.TIME_ELAPSED_EXT, q);
      const d0 = draws;
      f();
      if (q) {
        gl!.endQuery(ext!.TIME_ELAPSED_EXT);
        pending.push(q);
      }
      s.frames++;
      s.draws.push(draws - d0);
      s.cpuMs.push(performance.now() - t);
      poll();
    },
  };
  const clip = (x: number, y: number, w: number, h: number) => {
    const sc = app.renderer.screen;
    const cw = Math.min(x + w, sc.width) - Math.max(x, 0);
    const ch = Math.min(y + h, sc.height) - Math.max(y, 0);
    return cw > 0 && ch > 0 ? cw * ch : 0;
  };
  /** Screen pixels covered by what the last frame drew, over the screen's pixels, and the objects and tiles drawn. */
  const overdraw = () => {
    let area = 0;
    let objects = 0;
    let quads = 0;
    const walk = (c: Container) => {
      if (!c.visible || !c.renderable || c.culled) return;
      if (c instanceof Tilemap) {
        const m = (c as GroupTilemap).screenTransform;
        const pb = (c as unknown as { pointsBuf: number[] }).pointsBuf;
        for (let i = 0; i < pb.length; i += POINT_STRUCT_SIZE) {
          const a = clip(m.a * pb[i + 2] + m.tx, m.d * pb[i + 3] + m.ty, m.a * pb[i + 4], m.d * pb[i + 5]);
          if (a) quads++;
          area += a;
        }
        return;
      }
      if (c.isCachedAsTexture || c.children.length === 0) {
        const b = c.getBounds();
        const a = clip(b.x, b.y, b.width, b.height);
        if (a) objects++;
        area += a;
        if (c.isCachedAsTexture) return;
      }
      for (const ch of c.children) walk(ch);
    };
    walk(app.stage);
    const sc = app.renderer.screen;
    return { overdraw: area / (sc.width * sc.height), objects, quads };
  };
  const pct = (xs: number[], p: number) =>
    xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  (globalThis as unknown as { __mapStats: unknown }).__mapStats = {
    reset() {
      s.frames = 0;
      s.draws = [];
      s.cpuMs = [];
      s.gpuMs = [];
      Object.assign(chunkStats, { builds: 0, buildMs: 0, buildMax: 0, rebleeds: 0, rebleedMs: 0 });
    },
    snapshot() {
      return {
        webgl: s.webgl,
        gpuTimer: s.gpuTimer,
        frames: s.frames,
        drawsAvg: avg(s.draws),
        drawsMax: Math.max(0, ...s.draws),
        renderCpuAvg: avg(s.cpuMs),
        renderCpuP95: pct(s.cpuMs, 0.95),
        gpuAvg: avg(s.gpuMs),
        gpuP95: pct(s.gpuMs, 0.95),
        gpuSamples: s.gpuMs.length,
        textureBytes: textureBytes(),
        ...chunkStats,
      };
    },
    overdraw,
    /** The layers in the order stacked: how many leaves each holds, a tilemap counting its quads. */
    stack() {
      const count = (c: Container): number =>
        c instanceof Tilemap
          ? (c as unknown as { pointsBuf: number[] }).pointsBuf.length / POINT_STRUCT_SIZE
          : c.children.length
            ? c.children.reduce((n, ch) => n + count(ch), 0)
            : 1;
      return app.stage.children[0].children.map(count);
    },
    /** Each chunked layer: its chunks, how many are shown, their drawings and tilemaps. */
    chunks() {
      return [...(stats.chunkLayers ?? [])].map(([n, l]) => [n, l.describe()]);
    },
  };
  return stats;
}
