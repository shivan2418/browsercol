// @vitest-environment jsdom
import { Container, Rectangle } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { CHUNK, ChunkLayer, chunkOf, mapRender, type ChunkBackend, type Item } from './map-render';
import { tileOrigin } from './view';

describe('mapRender', () => {
  it("is the page's ?maprender=, or sprites for none or one it does not know", () => {
    expect(mapRender('?maprender=tilemap')).toBe('tilemap');
    expect(mapRender('?preset=pan-large&maprender=chunks')).toBe('chunks');
    expect(mapRender('?maprender=margin')).toBe('margin');
    expect(mapRender('')).toBe('sprites');
    expect(mapRender('?maprender=voxels')).toBe('sprites');
  });
});

describe('chunkOf', () => {
  const key = (x: number, y: number) => chunkOf(x, y).join();

  it('puts 16 by 16 tiles along the diamond grid in a chunk', () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) counts.set(key(x, y), (counts.get(key(x, y)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(CHUNK * CHUNK);
  });

  it('keeps a tile behind another (north, north-east, north-west) in a chunk drawn no later', () => {
    // The chunks are drawn by the sum of their two numbers: a tile's picture spills onto those behind it, and must
    // be drawn after them.
    const sum = (x: number, y: number) => chunkOf(x, y).reduce((a, b) => a + b);
    for (let y = 2; y < 80; y++)
      for (let x = 1; x < 60; x++) {
        const odd = y % 2;
        for (const [bx, by] of [
          [x, y - 2],
          [x - 1 + odd, y - 1],
          [x + odd, y - 1],
        ])
          expect(sum(bx, by)).toBeLessThanOrEqual(sum(x, y));
      }
  });
});

describe('ChunkLayer', () => {
  const pic = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const grass = pic(128, 64);
  const water = [pic(128, 64), pic(128, 64)];
  const item = (x: number, y: number, p: HTMLCanvasElement): [[number, number], Item] => {
    const [ox, oy] = tileOrigin(x, y);
    return [
      [x, y],
      {
        key: `i${p === grass ? 'g' : water.indexOf(p)},${x},${y}`,
        pic: p,
        x: ox,
        y: oy,
        dim: false,
        tile: true,
        box: [ox, oy, 128, 64],
      },
    ];
  };
  const setup = () => {
    const built: string[] = [];
    const backend: ChunkBackend = {
      build: (c) => built.push(c.key),
      release: () => {},
      rescale: () => {},
    };
    const root = new Container();
    const layer = new ChunkLayer(root, backend);
    const draw = (items: [[number, number], Item][]) => {
      layer.begin();
      for (const [t, it] of items) layer.push(t, it);
      layer.end();
    };
    return { built, root, layer, draw };
  };
  // Tile (0,0) and tile (40,0), in chunks far apart.
  const scene = (w: HTMLCanvasElement) => [item(0, 0, grass), item(0, 0, w), item(40, 0, grass)];

  it('builds the chunks on the screen, and the others once they come on it', () => {
    const { built, layer, draw } = setup();
    layer.setView(new Rectangle(0, 0, 300, 300), new Rectangle(0, 0, 300, 300));
    draw(scene(water[0]));
    expect(built).toEqual([chunkOf(0, 0).join()]);
    layer.setView(new Rectangle(40 * 128, 0, 300, 300), new Rectangle(40 * 128, 0, 300, 300));
    expect(built).toEqual([chunkOf(0, 0).join(), chunkOf(40, 0).join()]);
  });

  it('builds again only a chunk whose drawings changed, and the water a new frame swaps', () => {
    const { built, layer, draw } = setup();
    const all = new Rectangle(-1000, -1000, 99999, 99999);
    layer.setView(all, all);
    draw(scene(water[0]));
    built.length = 0;
    draw(scene(water[0]));
    expect(built).toEqual([]);
    expect(layer.repicture([grass, water[1], grass])).toBe(true);
    expect(built).toEqual([chunkOf(0, 0).join()]);
    // Another count of pictures is another scene: it is drawn again instead.
    expect(layer.repicture([grass])).toBe(false);
  });

  it('stacks the chunks back to front', () => {
    const keys = new Map<Container, string>();
    const root = new Container();
    const layer = new ChunkLayer(root, {
      build: (c) => keys.set(c.container, c.key),
      release: () => {},
      rescale: () => {},
    });
    const all = new Rectangle(-99999, -99999, 999999, 999999);
    layer.setView(all, all);
    layer.begin();
    for (const [t, it] of [item(20, 30, grass), item(0, 0, grass), item(5, 31, grass), item(40, 2, grass)])
      layer.push(t, it);
    layer.end();
    const order = root.children.map((c) => keys.get(c)!.split(',').map(Number));
    expect(order).toHaveLength(4);
    const sums = order.map(([u, v]) => u + v);
    expect(sums).toEqual(sums.toSorted((a, b) => a - b));
  });
});
