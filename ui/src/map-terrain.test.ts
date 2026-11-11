import { describe, expect, it } from 'vite-plus/test';
import { terrainStrips, wholeMapView } from './map';
import { resources } from './resources';
import { staticScene, type MapView, type Op } from './tileset';

// A long map of land and sea, with beaches all down it, and a river into the sea.
const w = 6;
const h = 40;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const tiles = Array.from({ length: w * h }, () => (rnd() < 0.35 ? 'A' : 'B')).join('');
const base: MapView = {
  w,
  h,
  turn: 'Spring 1492',
  turnLabel: 'Spring 1492',
  nation: 'model.nation.dutch',
  statusLine: '',
  ourTurn: true,
  colonial: true,
  europe: true,
  types: [],
  tiles: '.'.repeat(w * h),
  seen: '0'.repeat(w * h),
  owners: '.'.repeat(w * h),
  players: [],
  rivers: [],
  roads: [],
  items: [],
  settlements: [],
  units: [],
  active: null,
  activeUnit: null,
};
const terrain = {
  w,
  h,
  types: [
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
  ],
  tiles,
  rivers: [] as MapView['rivers'],
};
const dirs = ['ne', 'se', 'sw', 'nw', 'n', 'e', 's', 'w'];
const props = [
  'image.mask=resources/mask.png',
  'image.tile.model.tile.beach=resources/beach0.png',
  'image.tile.model.tile.plains.center=resources/plains0.png',
  'image.tile.model.tile.ocean.center=resources/ocean0.png',
  ...dirs.map((d) => `image.mask.beach.${d}=resources/beach_${d}.png`),
].join('\n');
const files = ['mask', 'beach0', 'plains0', 'ocean0', ...dirs.map((d) => `beach_${d}`)].map(
  (f) => `default/resources/${f}.png`,
);
const res = resources([{ dir: 'default', props }], files);
const shoreOps = (ops: Op[]) => ops.filter((op) => op.k === 'image' && op.shore === true);

describe('terrainStrips', () => {
  it('makes the whole map’s shore ops a strip at a time, as one scene of the whole map makes them', () => {
    const all = wholeMapView(base, terrain);
    const scene = staticScene(all, res, 1, 'surface');
    const whole = shoreOps([...scene.base, ...scene.below]);
    expect(whole.length).toBeGreaterThan(10);
    const strips = [...terrainStrips(all, 7)];
    expect(strips.map((s) => [s.y0, s.y1])).toEqual([
      [0, 7],
      [7, 14],
      [14, 21],
      [21, 28],
      [28, 35],
      [35, 40],
    ]);
    const parts = strips.flatMap(({ strip, y0, y1 }) => {
      const s = staticScene(strip, res, 1, 'surface');
      return shoreOps([...s.base, ...s.below]).filter((op) => op.y >= y0 && op.y < y1);
    });
    const key = (op: Op) => JSON.stringify(op);
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
  });

  it('sees every tile of the terrain, explored and in sight, with nothing on it', () => {
    const all = wholeMapView({ ...base, units: [{} as MapView['units'][number]] }, terrain);
    expect(all.tiles).toBe(tiles);
    expect(all.seen).toBe('1'.repeat(w * h));
    expect(all.units).toEqual([]);
  });
});
