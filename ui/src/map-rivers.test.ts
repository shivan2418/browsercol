import { describe, expect, it, vi } from 'vite-plus/test';
import { riverDrawing, riverPatches } from './map-rivers';
import { resources } from './resources';
import { frameAt, srcId, staticScene, STILL, type MapView, type Op, type Recipe } from './tileset';

// A minor river on the plains at (0,1) runs NE into the ocean at (1,0), which draws its delta from the SW.
//   row 0:  P  O
//   row 1:    P  P
//   row 2:  P  P
const map: MapView = {
  w: 2,
  h: 3,
  turn: 'Spring 1492',
  turnLabel: 'Spring 1492',
  nation: 'model.nation.dutch',
  statusLine: '',
  ourTurn: true,
  colonial: true,
  europe: true,
  types: [
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
  ],
  tiles: 'AB' + 'AA' + 'AA',
  seen: '111111',
  owners: '......',
  players: [],
  rivers: [[0, 1, 1, '1000', '0100']],
  roads: [],
  items: [],
  settlements: [],
  units: [],
  active: null,
  activeUnit: null,
};
const props = `
image.mask=resources/mask.png
image.mask.beach.sw=resources/beach_sw.png
image.tile.model.tile.beach=resources/beach0.png
image.tile.model.tile.plains.center=resources/plains0.png
image.tile.model.tile.ocean.center=resources/ocean0.png
image.tile.river.pebbles=resources/pebbles.png
image.tile.river.water=resources/riverwater.png
image.mask.river.minor.ne=resources/river-ne.png
image.mask.river.delta.sw=resources/delta-sw.png
image.mask.river.delta.pebbles.sw=resources/delta-pebbles-sw.png
`;
const art = (f: string) => `default/resources/${f}.png`;
const files = [
  'mask',
  'beach_sw',
  'beach0',
  'plains0',
  'ocean0',
  'pebbles',
  'riverwater',
  'river-ne',
  'delta-sw',
  'delta-pebbles-sw',
].map(art);
const res = resources([{ dir: 'default', props }], files);
/** The ground's base ops as BrowserCol draws them, over the shader water. */
const baseOf = (m: MapView) => staticScene(m, res, 1, 'surface').base;
const still = (op: Op | undefined) => (op?.k === 'image' ? (frameAt(op.src, STILL) as Recipe) : null);

describe('riverPatches', () => {
  it("takes the water out of the river's and its mouth's recipes, keeping their banks, and leaves the rest", () => {
    const base = baseOf(map);
    const { banks, patches } = riverPatches(map, base);
    expect(banks.length).toBe(base.length);
    // What is no river is the same op.
    base.forEach((op, i) => {
      const id = op.k === 'image' ? srcId(op.src) : '';
      if (!id.startsWith('river:') && !id.startsWith('delta:')) expect(banks[i]).toBe(op);
    });
    const river = still(
      base.find((op) => op.x === 0 && op.y === 1 && op.k === 'image' && srcId(op.src).startsWith('river:')),
    );
    const bank = banks.find((op) => op.k === 'image' && srcId(op.src) === `flow-banks:${river!.id}`);
    // The pebbles and the masks that soften them; not the masked water, the recipe's second step.
    expect(bank?.k === 'image' && bank.src).toEqual({
      id: `flow-banks:${river!.id}`,
      steps: [river!.steps[0], ...river!.steps.slice(2)],
    });
    const delta = banks.find((op) => op.k === 'image' && srcId(op.src).startsWith('flow-banks:delta:'));
    expect([delta?.x, delta?.y]).toEqual([1, 0]);
    // The river flows NE, out to sea; its mouth, on the ocean tile's SW side, flows on NE away from the land.
    expect(patches.map((p) => [p.x, p.y, p.downstream, p.style, p.magnitude, !!p.keep])).toEqual([
      [1, 0, 0, '0000', 1, true],
      [0, 1, 0, '1000', 1, false],
    ]);
    // The mesh draws the water in the river's own shape: its mask, then the masks softening it.
    const own = patches.find((p) => p.x === 0)!;
    expect(own.mask.steps).toEqual([{ draw: art('river-ne') }, ...river!.steps.slice(2)]);
  });

  it('keys what the mesh shows by the rivers alone: ground explored keeps the key, a river grown changes it', () => {
    const { key } = riverPatches(map, baseOf(map));
    const explored = { ...map, tiles: 'AB' + 'AA' + 'BA' };
    expect(riverPatches(explored, baseOf(explored)).key).toBe(key);
    const major = { ...map, rivers: [[0, 1, 2, '2000', '0200']] as MapView['rivers'] };
    expect(riverPatches(major, baseOf(major)).key).not.toBe(key);
    expect(riverPatches({ ...map, rivers: [] }, baseOf({ ...map, rivers: [] })).key).toBe('');
  });
});

describe('riverDrawing', () => {
  it('makes no mesh, and loads no picture, for the rivers the mesh drawn already shows', async () => {
    const base = baseOf(map);
    const get = vi.fn(() => Promise.reject(new Error('not loaded')));
    const { key } = riverPatches(map, base);
    const drawing = await riverDrawing(map, base, get, key);
    expect(drawing.key).toBe(key);
    expect(drawing.geometry).toBeUndefined();
    expect(drawing.banks).toEqual(riverPatches(map, base).banks);
    expect(get).not.toHaveBeenCalled();
  });
});
