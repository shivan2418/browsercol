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
  build(c: Chunk): void;
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

/** One static layer, drawn per chunk. */
export class ChunkLayer {
  private chunks = new Map<string, Chunk>();
  private next: Item[] | null = null;
  /** Each pass's container in the layer, which holds the chunks' parts of that pass back to front. */
  private passes: Container[] = [];
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
    // In the order they were drawn, as repicture() gets them.
    this.images = items.filter((it) => it.pic).map((item) => ({ item, chunk: this.chunks.get(item.chunk!)! }));
    this.refresh();
  }

  /** The animated base's next frame: the same pictures in the same places, but other pictures. */
  repicture(pics: Picture[]): boolean {
    if (pics.length !== this.images.length) return false;
    pics.forEach((p, i) => {
      const { item, chunk } = this.images[i];
      if (item.pic === p) return;
      item.pic = p;
      item.key = pictureKey(p, item.x, item.y, item.dim);
      chunk.dirty = true;
    });
    for (const c of this.chunks.values()) if (c.dirty) c.sig = signature(c.items);
    this.refresh();
    return true;
  }

  /** What is on the screen, and what to keep built round it, in map pixels. */
  setView(view: Rectangle, keep: Rectangle) {
    this.view = view;
    this.keep = keep;
    this.refresh();
  }

  rescale(k: number) {
    this.backend.rescale(k);
    this.refresh();
  }

  /** Each chunk shown or hidden, built if shown and changed, and let go of when far off. */
  private refresh() {
    for (const c of this.chunks.values()) {
      const on = c.box.intersects(this.view);
      for (const part of c.parts) if (part) part.visible = on;
      if (on && c.dirty) {
        this.backend.build(c);
        c.dirty = false;
      } else if (!on && !c.box.intersects(this.keep) && (c.maps.length || c.objects.length)) {
        this.backend.release(c);
        c.dirty = true;
      }
    }
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
      atlas.flush();
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
