// The map's static layers (the animated base, the scene under the units and the scene over them) as tilemaps (#407):
// per chunk of 16x16 tiles, one list of "this picture at this place", which the GPU draws in a draw call or two,
// instead of a Sprite per picture that PixiJS has to walk, cull and batch each frame. Their pictures live in a few
// atlas pages, each picture once; one no chunk uses any more gives its room back.
//
// The map is drawn in passes (tileset.ts passOf: the terrain of every tile, then the transitions, the fog, the edges of the
// unexplored, then each tile's items), and a picture may cover any tile round it: a mountain's foot covers the
// ground of the tile in front of it. So a layer draws each pass for all its chunks before the next pass, and within a
// pass the chunks back to front. The chunks are 16x16 in the diamond grid (along the tiles' sides), not in rows and
// columns: within a pass a tile's picture covers the tiles behind it, which are in its chunk or one drawn before it.
// (Two tiles side by side across a chunk's north-east edge are drawn east first; the widest static art, 130 px hills
// and villages, overlaps its 128 px tile by a pixel each side.)
//
// What is not a picture (a settlement's name, a modern label's shapes) is an object between the tilemaps, in the order
// drawn. Only a chunk whose drawings changed is built again, and only once it is near the screen.
//
// The tilemaps are @pixi/tilemap's, with two of its bugs mended in ChunkTilemap. They need WebGL; on PixiJS's Canvas
// or WebGPU renderer the map draws its static layers as sprites (staticDrawing).
import { Container, Rectangle, Texture } from 'pixi.js';
import { POINT_STRUCT_SIZE, Tilemap, settings as tilemapSettings } from '@pixi/tilemap';
import { H, W } from './view';

export const CHUNK = 16;

/** The chunk a tile is in: tiles along the diamond grid's two axes, 16 by 16. */
export function chunkOf(x: number, y: number): [number, number] {
  const u = x + ((y + 1) >> 1);
  const v = (y >> 1) - x;
  return [Math.floor(u / CHUNK), Math.floor(v / CHUNK)];
}

/** Whether chunk a is drawn before chunk b: back to front, and along a diagonal west to east. */
export const chunkOrder = (a: { cu: number; cv: number }, b: { cu: number; cv: number }): number =>
  a.cu + a.cv - (b.cu + b.cv) || a.cu - a.cv - (b.cu - b.cv);

/**
 * How the static layers are drawn on a PixiJS renderer: as tilemaps on WebGL (1 or 2), which @pixi/tilemap needs, else
 * (PixiJS's Canvas renderer, without WebGL; or WebGPU) as sprites, as before #407.
 */
export const staticDrawing = (renderer: { name: string }): 'tilemap' | 'sprites' =>
  renderer.name === 'webgl' ? 'tilemap' : 'sprites';

export type Picture = HTMLImageElement | HTMLCanvasElement;

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
  /** The chunk it is in, and the pass of the drawing it is in. */
  chunk?: string;
  pass?: number;
}

export interface Chunk {
  key: string;
  cu: number;
  cv: number;
  items: Item[];
  sig: string;
  /** What it draws in each pass, in that pass's place in the layer. */
  parts: (Container | undefined)[];
  box: Rectangle;
  dirty: boolean;
  /** What the chunk was built with: its objects, to destroy, its tilemaps, to reuse, and its atlas pictures. */
  objects: Container[];
  maps: Tilemap[];
  entries: Entry[];
}

/** What builds a chunk's drawing. */
export interface ChunkBackend {
  /** Build a chunk's drawing; flush() then sends what it drew to the GPU. */
  build(c: Chunk): void;
  /** Send the pictures the chunks built since the last time drew to the GPU, once for them all. */
  flush(): void;
  /** The chunk is well off the screen, or gone: let go of what it holds; it is built again when it comes back. */
  release(c: Chunk): void;
  /** The map's scale (times the screen's pixel ratio) changed. */
  rescale(k: number): void;
}

const ids = new WeakMap<Picture, number>();
let nextId = 1;
/** A number for a picture, the same each time it is asked. */
const picId = (p: Picture) => {
  let id = ids.get(p);
  if (!id) ids.set(p, (id = nextId++));
  return id;
};

/** What a picture drawn at a place shows, to tell whether a chunk changed. */
export const pictureKey = (p: Picture, x: number, y: number, dim: boolean) => `i${picId(p)},${x},${y},${dim}`;

/** What a chunk draws, pass by pass: the same signature, the same drawing. */
const signature = (items: Item[]) => items.map((i) => `${i.pass}:${i.key}`).join('|');

/** Runs `work` when the page is idle; `more()` tells whether there is time left for more of it. */
export type Idle = (work: (more: () => boolean) => void) => void;

/** requestIdleCallback, waiting at most half a second; without it, a timer and 4 ms. */
export const whenIdle: Idle = (work) => {
  if (typeof requestIdleCallback === 'function')
    requestIdleCallback((d) => work(() => d.timeRemaining() > 1), { timeout: 500 });
  else
    setTimeout(() => {
      const end = performance.now() + 4;
      work(() => performance.now() < end);
    }, 16);
};

/** One static layer, drawn per chunk. */
export class ChunkLayer {
  private chunks = new Map<string, Chunk>();
  private next: Item[] | null = null;
  /** Each pass's container in the layer, which holds the chunks' parts of that pass back to front. */
  private passes: Container[] = [];
  /** A count that moves on when a chunk comes on the screen or is built again: what the animated water checks. */
  shownVersion = 0;
  private view = new Rectangle();
  private keep = new Rectangle();
  private ahead = new Rectangle();
  /** Whether chunks near the screen wait to be built when the page is idle. */
  private waiting = false;
  constructor(
    readonly root: Container,
    private backend: ChunkBackend,
    private idle: Idle = whenIdle,
  ) {
    // The chunks cull themselves (see setView): PixiJS's culler need not walk the layer.
    root.cullableChildren = false;
  }

  begin() {
    this.next = [];
  }

  /** A drawing on a tile, in a pass of the map's drawing (tileset.ts passOf). */
  push(tile: [number, number], pass: number, item: Item) {
    const [cu, cv] = chunkOf(...tile);
    item.chunk = `${cu},${cv}`;
    item.pass = pass;
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
      const sig = signature(list);
      let c = this.chunks.get(k);
      if (!c) {
        const [cu, cv] = k.split(',').map(Number);
        c = {
          key: k,
          cu,
          cv,
          items: [],
          sig: '',
          parts: [],
          box: new Rectangle(),
          dirty: true,
          objects: [],
          maps: [],
          entries: [],
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
        const passes = new Set(list.map((i) => i.pass!));
        if (c.parts.some((part, p) => part && !passes.has(p))) this.backend.release(c);
        c.parts.forEach((part, p) => {
          if (!part || passes.has(p)) return;
          part.destroy({ children: true });
          c!.parts[p] = undefined;
          reorder = true;
        });
        for (const p of passes)
          if (!c.parts[p]) {
            c.parts[p] = new Container();
            reorder = true;
          }
      } else {
        // The same drawings: the built chunk stays, with its items, whose pictures repicture() swaps.
        const kept = c.items;
        at.forEach((i, n) => (items[i] = kept[n]));
      }
    }
    if (reorder) {
      const order = [...this.chunks.values()].sort(chunkOrder);
      const count = Math.max(0, ...order.map((c) => c.parts.length));
      while (this.passes.length < count) this.root.addChild((this.passes[this.passes.length] = new Container()));
      this.passes.forEach((pass, p) => {
        pass.removeChildren();
        const parts = order.map((c) => c.parts[p]).filter((part) => part !== undefined);
        if (parts.length) pass.addChild(...parts);
      });
    }
    this.refresh();
  }

  /**
   * The pictures the built chunks draw: those on the screen and those kept built round it, so a chunk coming back on
   * the screen shows the frame the rest does.
   */
  shownPictures(): Set<Picture> {
    const pics = new Set<Picture>();
    for (const c of this.chunks.values())
      if (c.maps.length || c.objects.length) for (const it of c.items) if (it.pic) pics.add(it.pic);
    return pics;
  }

  /**
   * What is on the screen, and what to keep built round it, in map pixels; and what to build ahead, when the page is
   * idle, so a pan seldom has to build a chunk in the frame it comes on the screen (#419).
   */
  setView(view: Rectangle, keep: Rectangle, ahead: Rectangle = view) {
    this.view = view;
    this.keep = keep;
    this.ahead = ahead;
    this.refresh();
  }

  rescale(k: number) {
    this.backend.rescale(k);
    this.refresh();
  }

  /**
   * Each chunk shown or hidden, built if shown and changed, and let go of when far off; those near the screen are
   * built when the page is idle.
   */
  private refresh() {
    let built = false;
    let ahead = false;
    for (const c of this.chunks.values()) {
      const on = c.box.intersects(this.view);
      for (const part of c.parts)
        if (part && part.visible !== on) {
          part.visible = on;
          if (on) this.shownVersion++;
        }
      if (on && c.dirty) {
        this.build(c);
        built = true;
      } else if (!on && !c.box.intersects(this.keep) && (c.maps.length || c.objects.length)) {
        this.backend.release(c);
        c.dirty = true;
      } else if (!on && c.dirty && c.box.intersects(this.keep)) ahead ||= c.box.intersects(this.ahead);
    }
    if (built) this.backend.flush();
    if (ahead && !this.waiting) {
      this.waiting = true;
      this.idle((more) => this.buildAhead(more));
    }
  }

  private build(c: Chunk) {
    this.backend.build(c);
    c.dirty = false;
    this.shownVersion++;
  }

  /** Build the chunks near the screen not built yet, nearest first, at least one, while the page has time. */
  private buildAhead(more: () => boolean) {
    this.waiting = false;
    const [x, y] = [this.view.x + this.view.width / 2, this.view.y + this.view.height / 2];
    const far = (c: Chunk) => Math.hypot(c.box.x + c.box.width / 2 - x, c.box.y + c.box.height / 2 - y);
    const todo = [...this.chunks.values()]
      .filter((c) => c.dirty && c.box.intersects(this.ahead) && c.box.intersects(this.keep))
      .sort((a, b) => far(a) - far(b));
    let n = 0;
    while (n < todo.length && (n === 0 || more())) this.build(todo[n++]);
    if (n) this.backend.flush();
    if (n < todo.length) this.refresh();
  }

  private destroy(c: Chunk) {
    this.backend.release(c);
    for (const part of c.parts) part?.destroy({ children: true });
  }
}

/** Room round each atlas picture, so a scaled tile samples none of its neighbours. */
const PAD = 2;
/**
 * How far a whole tile's quad reaches past the tile, in map pixels: room for its bleed, which is 1.5 device pixels,
 * 6 map pixels at the farthest zoom (0.25) and a pixel ratio of 1, half of it each side.
 */
const TILE_PAD = 4;

/** A picture's place in the atlas, and how many chunks draw it. */
export interface Entry {
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
  /** The slot it takes, padding included, which it gives back when no chunk uses it. */
  slot: { page: number; x: number; y: number; w: number; h: number };
  refs: number;
}

/** An atlas page: a canvas the pictures are drawn on, and its texture. */
export interface Page {
  g: Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'>;
  texture: Texture;
}

/** A new page of `size` pixels square: a canvas and a texture of it. */
const canvasPage = (size: number): Page => {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  return { g: canvas.getContext('2d')!, texture: Texture.from(canvas) };
};

/**
 * The tilemaps' pictures, each once, on pages of 2048 pixels square (the most a weak GPU is sure to take is 4096),
 * with room round each. A whole tile's picture is drawn at the size the map's scale needs it to overlap its neighbours
 * (seamBleed), and drawn again when that changes. A picture no chunk draws any more (the water's last frame, ground
 * explored over) gives its slot back to the next picture of the same size.
 */
export class Atlas {
  private pages: (Page & { x: number; y: number; rowH: number; dirty: boolean })[] = [];
  private entries = new Map<Picture, Entry>();
  private tileEntries = new Map<Picture, Entry>();
  /** Slots given back, by their size. */
  private free = new Map<string, Entry['slot'][]>();
  private bleed = 0;
  constructor(
    readonly pageSize = 2048,
    readonly maxPages = tilemapSettings.TEXTURES_PER_TILEMAP,
    private newPage: (size: number) => Page = canvasPage,
  ) {}

  /** A picture's entry, drawn on a page if it is not yet, counted as used once more; null when the atlas is full. */
  acquire(pic: Picture, tile: boolean): Entry | null {
    const map = tile ? this.tileEntries : this.entries;
    let e = map.get(pic);
    if (!e) {
      const [w, h] = tile ? [W + 2 * TILE_PAD, H + 2 * TILE_PAD] : [pic.width, pic.height];
      const slot = this.alloc(w + 2 * PAD, h + 2 * PAD);
      if (!slot) return null;
      e = {
        page: slot.page,
        u: slot.x + PAD,
        v: slot.y + PAD,
        w,
        h,
        ox: tile ? -TILE_PAD : 0,
        oy: tile ? -TILE_PAD : 0,
        pic,
        tile,
        slot,
        refs: 0,
      };
      map.set(pic, e);
      this.paint(e);
    }
    e.refs++;
    return e;
  }

  /** A chunk no longer draws this entry; once none does, its slot is free. */
  release(e: Entry) {
    if (--e.refs > 0) return;
    (e.tile ? this.tileEntries : this.entries).delete(e.pic);
    const k = `${e.slot.w}x${e.slot.h}`;
    const l = this.free.get(k);
    if (l) l.push(e.slot);
    else this.free.set(k, [e.slot]);
  }

  /** How many pictures the atlas holds, and on how many pages. */
  get size() {
    return { pictures: this.entries.size + this.tileEntries.size, pages: this.pages.length };
  }

  private alloc(w: number, h: number): Entry['slot'] | null {
    const reused = this.free.get(`${w}x${h}`)?.pop();
    if (reused) return reused;
    let p = this.pages.at(-1);
    if (p && p.x + w > this.pageSize) {
      p.x = 0;
      p.y += p.rowH;
      p.rowH = 0;
    }
    if (!p || p.y + h > this.pageSize) {
      if (this.pages.length >= this.maxPages) {
        console.warn(`map atlas: all ${this.maxPages} pages are full; a picture is left out`);
        return null;
      }
      p = { ...this.newPage(this.pageSize), x: 0, y: 0, rowH: 0, dirty: true };
      this.pages.push(p);
    }
    const slot = { page: this.pages.length - 1, x: p.x, y: p.y, w, h };
    p.x += w;
    p.rowH = Math.max(p.rowH, h);
    return slot;
  }

  private paint(e: Entry) {
    const p = this.pages[e.page];
    p.g.clearRect(e.slot.x, e.slot.y, e.slot.w, e.slot.h);
    if (e.tile) {
      const b = Math.min(this.bleed, 2 * TILE_PAD);
      p.g.drawImage(e.pic, e.u + TILE_PAD - b / 2, e.v + TILE_PAD - b / 2, W + b, H + b);
    } else p.g.drawImage(e.pic, e.u, e.v);
    p.dirty = true;
  }

  /** These pictures' pixels changed (the animated water's next frame): draw them again where the atlas holds them. */
  repaint(pics: Iterable<Picture>) {
    for (const pic of pics) for (const e of [this.entries.get(pic), this.tileEntries.get(pic)]) if (e) this.paint(e);
    this.flush();
  }

  /** The tiles' bleed changed with the map's scale: draw the whole tiles again. */
  setBleed(b: number) {
    if (b === this.bleed) return;
    this.bleed = b;
    for (const e of this.tileEntries.values()) this.paint(e);
    this.flush();
  }

  /** Send the pages drawn on since the last time to the GPU. */
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

// Few samplers: each one is a branch in the fragment shader, which a weak GPU feels.
tilemapSettings.TEXTURES_PER_TILEMAP = 8;

/** TilemapGeometry's floats a vertex, and where in them the texture number is. */
const VERTEX_FLOATS = 13;
const TEXTURE_ID = 10;

/**
 * @pixi/tilemap 5.0.2's Tilemap, mended for the map:
 * - In a render group (each map layer is one) it draws with the group's transform times its world transform, which
 *   already holds the group's: the map moved twice. Its transform within the group is what the pipe needs.
 * - It sends each tile's texture number as a 32-bit integer attribute, which WebGL 1 cannot take ("glVertexAttribPointer:
 *   Invalid type"; nothing was drawn). The shader reads it as a float, so it is sent as one.
 * - It is a CompositeTilemap's child, so that it draws each tile from its own texture (a lone Tilemap uses its first).
 */
export class ChunkTilemap extends Tilemap {
  constructor(textures: Texture[]) {
    // @pixi/tilemap types the tileset as texture sources, but reads each one's .source: it takes textures.
    super(textures as never);
    this.compositeParent = true;
  }

  override get worldTransform() {
    return this.relativeGroupTransform;
  }

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
    const { vb, vbArray, vbInts } = self;
    if (!rewrite || !vb || !vbArray || !vbInts) return;
    vb.attributes.aTextureId.format = 'float32';
    const n = self.rects_count * 4;
    for (let i = TEXTURE_ID; i < n * VERTEX_FLOATS; i += VERTEX_FLOATS) vbArray[i] = vbInts[i] | 0;
    vb.getBuffer('aVertexPosition').update();
  }
}

/** Chunks as tilemaps over the atlas; what is not a picture is an object between them, in the order drawn. */
export function tilemapBackend(
  atlas: Atlas,
  dimmed: (p: Picture) => Picture,
  bleedAt: (k: number) => number,
): ChunkBackend {
  const clear = (c: Chunk) => {
    for (const part of c.parts) part?.removeChildren();
    for (const o of c.objects) o.destroy();
    c.objects = [];
  };
  return {
    build(c) {
      clear(c);
      // The new pictures are taken before the old are let go, so a picture in both keeps its place.
      const entries = c.items.map((it) => (it.pic ? atlas.acquire(it.dim ? dimmed(it.pic) : it.pic, it.tile) : null));
      for (const e of c.entries) atlas.release(e);
      c.entries = entries.filter((e) => e !== null);
      const textures = atlas.textures();
      let seg: Tilemap | null = null;
      let pass = -1;
      let used = 0;
      c.items.forEach((it, i) => {
        const e = entries[i];
        const part = c.parts[it.pass ?? 0]!;
        if (it.pass !== pass) {
          pass = it.pass ?? 0;
          seg = null;
        }
        if (e) {
          if (!seg) {
            seg = c.maps[used] ??= new ChunkTilemap(textures);
            used++;
            seg.clear();
            seg.setTileset(textures as never);
            part.addChild(seg);
          }
          seg.tile(e.page, it.x + e.ox, it.y + e.oy, { u: e.u, v: e.v, tileWidth: e.w, tileHeight: e.h });
        } else if (it.make) {
          seg = null;
          const o = it.make();
          c.objects.push(o);
          part.addChild(o);
        }
      });
      for (const m of c.maps.splice(used)) m.destroy();
    },
    flush() {
      atlas.flush();
    },
    release(c) {
      clear(c);
      for (const m of c.maps.splice(0)) m.destroy();
      for (const e of c.entries) atlas.release(e);
      c.entries = [];
    },
    rescale(k) {
      atlas.setBleed(bleedAt(k));
    },
  };
}
