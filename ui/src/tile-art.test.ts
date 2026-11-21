// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isometric, mapGrid, setView, topDown, type Projection } from './projection';
import {
  debugMarkers,
  placeTileArt,
  registerTileArt,
  tileArtLayers,
  tileSeed,
  unregisterTileArt,
  type TileArtContext,
  type TileArtLayer,
} from './tile-art';
import type { TileType } from './tileset';

const plains: TileType = { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' };
// A 3x2 map; (2,1) is unexplored.
const map = {
  w: 3,
  h: 2,
  typeAt: (x: number, y: number): TileType | null => (x === 2 && y === 1 ? null : plains),
};
const pic = document.createElement('canvas');

afterEach(() => {
  tileArtLayers()
    .map((l) => l.id)
    .forEach(unregisterTileArt);
  setView('isometric');
});

describe('placeTileArt', () => {
  it('calls no layer, and builds no context, when none is registered', () => {
    expect(tileArtLayers()).toHaveLength(0);
    const eachTile = vi.fn();
    const spy = { ...isometric, eachTile } as unknown as Projection;
    const put = vi.fn();
    placeTileArt(tileArtLayers(), map, spy, put);
    expect(eachTile).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    ['isometric', isometric],
    ['topdown', topDown],
  ])('calls a layer once per tile with the tile, its neighbours, a seed and the %s projection', (_, proj) => {
    const calls: TileArtContext[] = [];
    const layer: TileArtLayer = { id: 'spy', at: (c) => (calls.push(c), null) };
    placeTileArt([layer], map, proj, () => {});
    expect(calls).toHaveLength(map.w * map.h);
    expect(new Set(calls.map((c) => `${c.tile.x},${c.tile.y}`)).size).toBe(6);
    for (const c of calls) {
      expect(c.projection).toBe(proj);
      expect(c.seed).toBe(tileSeed(map.w, map.h, c.tile.x, c.tile.y));
      expect(c.origin).toEqual(proj.origin(c.tile.x, c.tile.y, map.h));
      expect(c.centre).toEqual(proj.centre(c.tile.x, c.tile.y, map.h));
      expect(Object.keys(c.neighbours).sort()).toEqual([...mapGrid.directions].sort());
    }
    const at = (x: number, y: number) => calls.find((c) => c.tile.x === x && c.tile.y === y)!;
    expect(at(2, 1).tile.type).toBeNull();
    expect(at(0, 0).tile.type).toBe(plains);
    // A neighbour is null off the map, and a tile of the map with its type on it.
    const around = Object.values(at(0, 0).neighbours);
    expect(around.filter((n) => n === null).length).toBeGreaterThan(0);
    expect(around.filter((n) => n !== null).every((n) => n!.x >= 0 && n!.x < 3 && n!.y >= 0 && n!.y < 2)).toBe(true);
  });

  it('gives each placed picture to put with its tile, and the layer that made it', () => {
    const layer: TileArtLayer = { id: 'one', at: ({ centre }) => [{ pic, x: centre[0], y: centre[1] }] };
    const put = vi.fn();
    placeTileArt([layer], map, topDown, put);
    expect(put).toHaveBeenCalledTimes(6);
    expect(put).toHaveBeenCalledWith([1, 0], { pic, x: 64 + 32, y: 32 }, layer);
  });

  it('runs every registered layer on every tile', () => {
    const a = vi.fn(() => null);
    const b = vi.fn(() => null);
    placeTileArt(
      [
        { id: 'a', at: a },
        { id: 'b', at: b },
      ],
      map,
      topDown,
      () => {},
    );
    expect(a).toHaveBeenCalledTimes(6);
    expect(b).toHaveBeenCalledTimes(6);
  });

  it('seeds the same tile of the same map the same, and other tiles and maps differently', () => {
    expect(tileSeed(3, 2, 1, 1)).toBe(tileSeed(3, 2, 1, 1));
    expect(tileSeed(3, 2, 1, 1)).not.toBe(tileSeed(3, 2, 1, 0));
    expect(tileSeed(3, 2, 1, 1)).not.toBe(tileSeed(4, 2, 1, 1));
  });
});

describe('the registry', () => {
  it('lists registered layers, replaces one of the same id, and unregisters', () => {
    const off = registerTileArt({ id: 'x', at: () => null });
    expect(tileArtLayers().map((l) => l.id)).toEqual(['x']);
    registerTileArt({ id: 'x', at: () => null });
    expect(tileArtLayers()).toHaveLength(1);
    off();
    expect(tileArtLayers()).toHaveLength(0);
  });

  it('shares one empty list while nothing is registered, so a build allocates nothing', () => {
    expect(tileArtLayers()).toBe(tileArtLayers());
  });
});

describe('the debug marker layer', () => {
  it.each([
    ['isometric', isometric],
    ['topdown', topDown],
  ])('puts a marker on the middle of each explored tile in the %s view, none on an unexplored one', (_, proj) => {
    const placed: [number, number, number, number][] = [];
    placeTileArt([debugMarkers], map, proj, ([x, y], p) =>
      placed.push([x, y, p.x + p.pic.width / 2, p.y + p.pic.height / 2]),
    );
    expect(placed).toHaveLength(5);
    expect(placed.some(([x, y]) => x === 2 && y === 1)).toBe(false);
    for (const [x, y, mx, my] of placed) expect([mx, my]).toEqual(proj.centre(x, y, map.h).map(Math.round));
  });
});
