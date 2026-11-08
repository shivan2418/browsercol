// @vitest-environment jsdom
import { Buffer, BufferUsage, Container, Rectangle, Texture } from 'pixi.js';
import { TilemapGeometry } from '@pixi/tilemap';
import { describe, expect, it } from 'vite-plus/test';
import {
  Atlas,
  CHUNK,
  ChunkLayer,
  ChunkTilemap,
  chunkOf,
  chunkOrder,
  staticDrawing,
  type ChunkBackend,
  type Item,
  type Page,
} from './map-tilemap';
import { H, W, tileOrigin } from './view';

describe('staticDrawing', () => {
  it('draws the static layers as tilemaps on WebGL, and as sprites on the Canvas and WebGPU renderers', () => {
    expect(staticDrawing({ name: 'webgl' })).toBe('tilemap');
    expect(staticDrawing({ name: 'canvas' })).toBe('sprites');
    expect(staticDrawing({ name: 'webgpu' })).toBe('sprites');
  });
});

describe('chunkOf', () => {
  const key = (x: number, y: number) => chunkOf(x, y).join();

  it('puts 16 by 16 tiles along the diamond grid in a chunk', () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) counts.set(key(x, y), (counts.get(key(x, y)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(CHUNK * CHUNK);
  });

  it('puts the tiles behind a tile (north, north-east, north-west) in its chunk or one drawn before it', () => {
    // A tile's picture spills onto the tiles behind it, so it must be drawn after them.
    const chunk = (x: number, y: number) => {
      const [cu, cv] = chunkOf(x, y);
      return { cu, cv };
    };
    for (let y = 2; y < 80; y++)
      for (let x = 1; x < 60; x++) {
        const odd = y % 2;
        for (const [bx, by] of [
          [x, y - 2],
          [x - 1 + odd, y - 1],
          [x + odd, y - 1],
        ])
          expect(chunkOrder(chunk(bx, by), chunk(x, y))).toBeLessThanOrEqual(0);
      }
  });
});

const pic = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const fakePage = (): Page => ({
  g: { clearRect: () => {}, drawImage: () => {} },
  texture: { source: { update: () => {} } } as unknown as Texture,
});

describe('ChunkLayer', () => {
  const grass = pic();
  const water = [pic(), pic()];
  const item = (x: number, y: number, p: HTMLCanvasElement): [[number, number], Item] => {
    const [ox, oy] = tileOrigin(x, y);
    const name = p === grass ? 'g' : water.indexOf(p);
    return [[x, y], { key: `i${name},${x},${y}`, pic: p, x: ox, y: oy, dim: false, tile: true, box: [ox, oy, W, H] }];
  };
  const setup = () => {
    const built: string[] = [];
    const released: string[] = [];
    const backend: ChunkBackend = {
      build: (c) => built.push(c.key),
      release: (c) => released.push(c.key),
      rescale: () => {},
    };
    const root = new Container();
    const layer = new ChunkLayer(root, backend);
    const draw = (items: [[number, number], Item][]) => {
      layer.begin();
      for (const [t, it] of items) layer.push(t, it);
      layer.end();
    };
    return { built, released, root, layer, draw };
  };
  // Tile (0,0) and tile (40,0), in chunks far apart.
  const scene = (w: HTMLCanvasElement) => [item(0, 0, grass), item(0, 0, w), item(40, 0, grass)];
  const all = new Rectangle(-99999, -99999, 999999, 999999);

  it('builds the chunks on the screen, and the others once they come on it', () => {
    const { built, layer, draw } = setup();
    layer.setView(new Rectangle(0, 0, 300, 300), new Rectangle(0, 0, 300, 300));
    draw(scene(water[0]));
    expect(built).toEqual([chunkOf(0, 0).join()]);
    layer.setView(new Rectangle(40 * W, 0, 300, 300), new Rectangle(40 * W, 0, 300, 300));
    expect(built).toEqual([chunkOf(0, 0).join(), chunkOf(40, 0).join()]);
  });

  it('builds again only a chunk whose drawings changed, and one the water swaps a picture of', () => {
    const { built, layer, draw } = setup();
    layer.setView(all, all);
    draw(scene(water[0]));
    built.length = 0;
    draw(scene(water[0]));
    expect(built).toEqual([]);
    // Ground explored or a forest cleared: another picture on tile (40,0).
    draw([item(0, 0, grass), item(0, 0, water[0]), item(40, 0, water[1])]);
    expect(built).toEqual([chunkOf(40, 0).join()]);
    built.length = 0;
    expect(layer.repicture([grass, water[1], water[1]])).toBe(true);
    expect(built).toEqual([chunkOf(0, 0).join()]);
    // Another count of pictures is another scene: it is drawn again instead.
    expect(layer.repicture([grass])).toBe(false);
  });

  it('lets go of a built chunk once it is well off the screen, and builds it again when it comes back', () => {
    const { built, released, layer, draw } = setup();
    // The fake backend builds nothing, so give the chunk something to let go of.
    layer.setView(all, all);
    draw(scene(water[0]));
    const far = new Rectangle(90000, 90000, 10, 10);
    const chunks = (layer as unknown as { chunks: Map<string, { maps: unknown[] }> }).chunks;
    for (const c of chunks.values()) c.maps.push({});
    layer.setView(far, far);
    expect(released.toSorted()).toEqual([chunkOf(0, 0).join(), chunkOf(40, 0).join()].toSorted());
    built.length = 0;
    layer.setView(all, all);
    expect(built.toSorted()).toEqual(released.toSorted());
  });

  /** A layer whose fake backend notes which chunk each part it builds is. */
  const keyed = () => {
    const keys = new Map<Container, string>();
    const root = new Container();
    const layer = new ChunkLayer(root, {
      build: (c) => c.parts.forEach((part) => part && keys.set(part, c.key)),
      release: () => {},
      rescale: () => {},
    });
    layer.setView(all, all);
    return { keys, root, layer };
  };

  it('stacks the chunks back to front', () => {
    const { keys, root, layer } = keyed();
    layer.begin();
    // One pass: the tiles row by row.
    for (const [t, it] of [item(0, 0, grass), item(40, 2, grass), item(20, 30, grass), item(5, 31, grass)])
      layer.push(t, it);
    layer.end();
    expect(root.children).toHaveLength(1);
    const order = root.children[0].children.map((c) => keys.get(c)!.split(',').map(Number));
    expect(order).toHaveLength(4);
    const sums = order.map(([u, v]) => u + v);
    expect(sums).toEqual(sums.toSorted((a, b) => a - b));
  });

  it("draws a pass for every chunk before the next pass, as a mountain's foot covers the ground in front of it", () => {
    const { keys, root, layer } = keyed();
    layer.begin();
    // The ground of tiles (0,0) and (0,1), in two chunks, then the items over them: a new pass starts at (0,0) again.
    for (const [t, it] of [item(0, 0, grass), item(40, 2, grass), item(0, 0, water[0]), item(40, 2, water[1])])
      layer.push(t, it);
    layer.end();
    expect(root.children).toHaveLength(2);
    const chunks = (n: number) => root.children[n].children.map((c) => keys.get(c));
    expect(chunks(0)).toEqual(chunks(1));
    expect(chunks(0)).toHaveLength(2);
  });
});

describe('Atlas', () => {
  it('holds each picture once, however many chunks draw it', () => {
    const atlas = new Atlas(512, 8, fakePage);
    const p = pic();
    const a = atlas.acquire(p, true)!;
    const b = atlas.acquire(p, true)!;
    expect(b).toBe(a);
    expect(atlas.size.pictures).toBe(1);
    // The same picture drawn as a whole tile and as itself are two entries: the tile's is drawn bleeding.
    expect(atlas.acquire(p, false)).not.toBe(a);
  });

  it("gives a picture's room back once no chunk draws it, so the water's frames do not fill the atlas", () => {
    const atlas = new Atlas(512, 1, fakePage);
    let frame = pic();
    let e = atlas.acquire(frame, true)!;
    // Many more frames than a 512-pixel page holds, each let go of when the next is drawn.
    for (let i = 0; i < 500; i++) {
      const next = pic();
      const n = atlas.acquire(next, true)!;
      expect(n).not.toBeNull();
      atlas.release(e);
      [frame, e] = [next, n];
    }
    expect(atlas.size).toEqual({ pictures: 1, pages: 1 });
  });

  it('keeps a picture another chunk still draws', () => {
    const atlas = new Atlas(512, 8, fakePage);
    const p = pic();
    const e = atlas.acquire(p, true)!;
    atlas.acquire(p, true);
    atlas.release(e);
    expect(atlas.acquire(p, true)).toBe(e);
  });

  it('leaves a picture out, rather than failing, once its pages are full', () => {
    const atlas = new Atlas(256, 1, fakePage);
    const kept = Array.from({ length: 20 }, () => atlas.acquire(pic(), true));
    expect(kept.filter((e) => e === null).length).toBeGreaterThan(0);
    expect(atlas.size.pages).toBe(1);
  });
});

describe('ChunkTilemap', () => {
  /** What @pixi/tilemap's pipe gives a tilemap to make its vertex buffer with. */
  const indices = new Buffer({ data: new Uint16Array(12), usage: BufferUsage.INDEX });
  const plugin = { createVb: () => new TilemapGeometry(indices), checkIndexBuffer: () => {} };
  const map = () => {
    const m = new ChunkTilemap([Texture.WHITE, Texture.WHITE]);
    m.tile(0, 0, 0, { u: 0, v: 0, tileWidth: 1, tileHeight: 1 });
    m.tile(1, 10, 0, { u: 0, v: 0, tileWidth: 1, tileHeight: 1 });
    return m;
  };

  it('sends the texture numbers as floats, which WebGL 1 can take', () => {
    const m = map();
    m.updateBuffer(plugin as never);
    const self = m as unknown as { vb: TilemapGeometry; vbArray: Float32Array };
    expect(self.vb.attributes.aTextureId.format).toBe('float32');
    // 4 vertices a tile, 13 floats a vertex, the texture number the 11th.
    const ids = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => self.vbArray[v * 13 + 10]);
    expect(ids).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    // Written again without new tiles, the floats stay floats.
    m.updateBuffer(plugin as never);
    expect(self.vbArray[4 * 13 + 10]).toBe(1);
  });

  it('draws with its transform within its render group, not the world transform that holds the group again', () => {
    const group = new Container({ isRenderGroup: true });
    const m = map();
    group.addChild(m);
    expect(m.worldTransform).toBe(m.relativeGroupTransform);
    expect(m.worldTransform).not.toBe(group.worldTransform);
  });
});
