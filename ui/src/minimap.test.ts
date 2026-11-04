import { describe, expect, it } from 'vite-plus/test';
import { BACKGROUNDS, imageSize, minimapTiles, placement, pointAt, tileSize, type MinimapOptions } from './minimap';
import type { MapView } from './tileset';

// A 3x2 map: plains and ocean, the plains owned by the Dutch, with a Dutch
// colony, an English ship, and a tile not yet explored.
const map = (more: Partial<MapView> = {}): MapView => ({
  w: 3,
  h: 2,
  turn: '1',
  turnLabel: 'Spring 1492',
  ourTurn: true,
  nation: 'model.nation.dutch',
  statusLine: '',
  types: [
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
  ],
  tiles: 'AAB' + 'BB.',
  seen: '110' + '100',
  owners: 'AA.' + '...',
  players: [{ name: 'Dutch', rgb: 0xff8000 }],
  rivers: [],
  roads: [],
  items: [],
  settlements: [
    {
      x: 1,
      y: 0,
      keys: [],
      rgb: 0xff8000,
      name: 'Nieuw Amsterdam',
      population: 1,
      bonus: 0,
      sizeChange: 0,
      chips: null,
    },
  ],
  units: [{ x: 2, y: 0, keys: [], rgb: 0xff0000, chip: '-', fg: 0, stack: 1, fade: false }],
  active: null,
  activeUnit: null,
  ...more,
});

/** FreeCol's colours from data/default/resources.properties. */
const COLOURS: Record<string, number> = {
  'color.economic.MiniMap.model.tile.plains': 0x24801f,
  'color.economic.MiniMap.model.tile.ocean': 0x6000ff,
  'color.politics.MiniMap.model.tile.plains': 0x24801f,
  'color.politics.MiniMap.model.tile.ocean': 0x9696f2,
};
const res = { color: (key: string, replacement = 0xff00ff) => COLOURS[key] ?? replacement };

const options = (more: Partial<MinimapOptions> = {}): MinimapOptions => ({
  borders: true,
  fog: true,
  background: 0,
  zoom: 2,
  ...more,
});

describe('the minimap tiles', () => {
  it('shows the explored tiles only, in their political colours with the owner over them', () => {
    const tiles = minimapTiles(map(), res, options());
    expect(tiles.map((t) => [t.x, t.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(tiles[0]).toMatchObject({ fill: 0x24801f, owner: 0xff8000 });
    expect(tiles[3]).toMatchObject({ fill: 0x9696f2, owner: null });
  });

  it('shows the economic colours and no owners with the borders off', () => {
    const tiles = minimapTiles(map(), res, options({ borders: false }));
    expect(tiles[0]).toMatchObject({ fill: 0x24801f, owner: null });
    expect(tiles[3]).toMatchObject({ fill: 0x6000ff, owner: null });
  });

  it('marks a settlement, or else the unit on a tile, in its owner’s colour', () => {
    const tiles = minimapTiles(map(), res, options());
    expect(tiles[0].marker).toBeNull();
    expect(tiles[1].marker).toEqual({ kind: 'settlement', rgb: 0xff8000 });
    expect(tiles[2].marker).toEqual({ kind: 'unit', rgb: 0xff0000 });
  });

  it('greys the tiles out of sight, unless the fog of war option is off', () => {
    expect(minimapTiles(map(), res, options()).map((t) => t.fogged)).toEqual([false, false, true, false, true]);
    expect(minimapTiles(map(), res, options({ fog: false })).some((t) => t.fogged)).toBe(false);
  });
});

describe('the minimap', () => {
  it('draws tiles 4 pixels wide per zoom level, from 4 to 24', () => {
    expect(tileSize(2)).toBe(8);
    expect(tileSize(0)).toBe(4);
    expect(tileSize(9)).toBe(24);
  });

  it('draws the whole map as tile-wide diamonds in staggered rows', () => {
    // MiniMap.recreateBufferImage: tileSize * width + tileSize / 2 by tileSize * height / 2 + tileSize / 4.
    expect(imageSize({ w: 40, h: 100 }, 8)).toEqual([324, 402]);
  });

  it('centres on what the map view is centred on, with a box round what it shows', () => {
    // At 8 pixels a tile, a 128-pixel tile is 16 times smaller. The view shows 640x480 at zoom 1, centred on (1344, 672).
    const view = { centre: [1344, 672] as [number, number], viewport: [640, 480] as [number, number], zoom: 1 };
    const p = placement(view, [224, 160], 8);
    expect(p.image).toEqual([112 - 84, 80 - 42]);
    expect(p.visible).toEqual([112 - 20, 80 - 15, 40, 30]);
    // Zoomed in twice as far, the view shows half as much.
    expect(placement({ ...view, zoom: 2 }, [224, 160], 8).visible).toEqual([112 - 10, 80 - 7.5, 20, 15]);
  });

  it('turns a point on it into the map point there', () => {
    const view = { centre: [1344, 672] as [number, number], viewport: [640, 480] as [number, number], zoom: 1 };
    expect(pointAt(view, [224, 160], 8, [112, 80])).toEqual([1344, 672]);
    expect(pointAt(view, [224, 160], 8, [122, 70])).toEqual([1344 + 160, 672 - 160]);
  });

  it('has FreeCol’s background colours: black, five greys and a light blue', () => {
    expect(BACKGROUNDS).toEqual([0x000000, 0x303030, 0x606060, 0x808080, 0xb0b0b0, 0xe0e0e0, 0xc8c8ff]);
  });
});
