import { describe, expect, it } from 'vite-plus/test';
import { resources } from './resources';
import { scene, type MapView, type Op } from './tileset';

// A 2x4 corner of a map. FreeCol stores the diamond grid as staggered rows,
// odd rows half a tile to the right, so from (1,0) the plains at (0,1),
// (1,1), (1,2) and (0,0) lie SW, SE, S and W.
//   row 0:  P  O        P plains, O ocean, H hills, . unexplored
//   row 1:    P  H
//   row 2:  .  P
//   row 3:    P  P
const map: MapView = {
  w: 2,
  h: 4,
  turn: 'Spring 1492',
  ourTurn: true,
  types: [
    { id: 'model.tile.plains', land: true, forested: false },
    { id: 'model.tile.ocean', land: false, forested: false },
    { id: 'model.tile.hills', land: true, forested: false },
  ],
  tiles: 'AB' + 'AC' + '.A' + 'AA',
  seen: '11' + '10' + '01' + '11',
  rivers: [],
  roads: [[0, 3, 150]],
  items: [[1, 1, 400, 'centered', 'image.tileitem.model.resource.ore']],
  settlements: [],
  units: [[0, 0, ['image.unit.model.unit.caravel.dutch', 'image.unit.model.unit.caravel'], 0xff8000, '-', 0, 3, false]],
  active: [0, 0],
};

const props = `
image.mask=resources/mask.png
image.mask.ne=resources/mask-ne.png
image.mask.nw=resources/mask-nw.png
image.mask.se=resources/mask-se.png
image.mask.sw=resources/mask-sw.png
image.mask.beach.se_sw=resources/beach_se_sw.png
image.tile.model.tile.beach=resources/beach0.png
image.tile.model.tile.plains.center=resources/plains0.png
image.tile.model.tile.hills.center=resource:image.tile.model.tile.plains.center
image.tileoverlay.model.tile.hills=resources/hills0.png
image.tile.model.tile.ocean.center=resources/ocean0.png
image.tile.model.tile.unexplored.center=resources/unexplored0.png
image.tile.model.tile.unexplored.border.S=resources/border_S0.png
image.tileitem.model.resource.ore=resources/ore.png
image.unit.model.unit.caravel=resources/caravel.png
`;
const files = [
  'mask',
  'mask-ne',
  'mask-nw',
  'mask-se',
  'mask-sw',
  'beach_se_sw',
  'beach0',
  'plains0',
  'hills0',
  'ocean0',
  'ocean02',
  'unexplored0',
  'border_S0',
  'ore',
  'caravel',
].map((f) => `default/resources/${f}.png`);
const tileset = resources([{ dir: 'default', props }], files);
const art = (f: string) => `default/resources/${f}.png`;

const at = (ops: Op[], x: number, y: number) => ops.filter((op) => op.x === x && op.y === y);

describe('scene', () => {
  it("draws each tile's terrain, and unexplored tiles as unexplored", () => {
    const ops = scene(map, tileset);
    expect(at(ops, 0, 0)[0]).toEqual({ k: 'image', x: 0, y: 0, src: art('plains0'), at: 'tile' });
    expect(at(ops, 1, 1)[0]).toEqual({ k: 'image', x: 1, y: 1, src: art('plains0'), at: 'tile' });
    expect(at(ops, 0, 2)[0]).toEqual({ k: 'image', x: 0, y: 2, src: art('unexplored0'), at: 'tile' });
  });

  it('draws what a Tileset mod puts on a key', () => {
    const mod = { dir: 'mods/flat', props: 'image.tile.model.tile.plains.center=plains.png' };
    const modded = resources([{ dir: 'default', props }, mod], [...files, 'mods/flat/plains.png']);
    expect(at(scene(map, modded), 0, 0)[0]).toMatchObject({ src: 'mods/flat/plains.png' });
  });

  it('puts a beach on water by land, masked to the land sides', () => {
    // Land lies SE, S, SW and W of (1,0). FreeCol keys the beach mask by
    // the long sides (se_sw), and S and W are dropped because their names
    // occur in "se_sw". The ocean is its first frame, variation 0.
    expect(at(scene(map, tileset), 1, 0)[0]).toEqual({
      k: 'image',
      x: 1,
      y: 0,
      at: 'tile',
      src: {
        id: 'beach:default/resources/ocean02.png:se_sw',
        steps: [
          { draw: art('beach0') },
          {
            draw: {
              id: 'mask:default/resources/ocean02.png:default/resources/beach_se_sw.png',
              steps: [{ draw: art('ocean02') }, { mask: art('beach_se_sw') }],
            },
          },
          { mask: art('mask') },
        ],
      },
    });
  });

  it('blends a land tile into its neighbours with masked transitions', () => {
    const ops = at(scene(map, tileset), 0, 1).filter((op) => op.k === 'image' && op.src !== art('plains0'));
    // (0,1) has the ocean NE: the beach shows through the NE mask. SW is
    // unexplored, so no transition. NW and SE are plains like it, but get
    // FreeCol's "nice corner" anyway: the neighbour's terrain with its own
    // NE and SW transitions (none here: the hills share the plains image).
    expect(ops.map((op) => op.k === 'image' && typeof op.src !== 'string' && op.src.id)).toEqual([
      'transition:default/resources/beach0.png:default/resources/mask-ne.png',
      expect.stringMatching(/^corner:.*mask-nw/),
      expect.stringMatching(/^corner:.*mask-se/),
    ]);
  });

  it('dims what the player cannot see now and fringes the unexplored', () => {
    const ops = scene(map, tileset);
    expect(ops).toContainEqual({ k: 'fog', x: 1, y: 1 });
    expect(ops).not.toContainEqual({ k: 'fog', x: 0, y: 2 });
    // (0,2) is unexplored and lies S of (0,0).
    expect(ops).toContainEqual({ k: 'image', x: 0, y: 0, src: art('border_S0'), at: 'tile' });
    expect(ops).toContainEqual({ k: 'image', x: 1, y: 1, src: art('hills0'), at: 'bottom', dim: true });
    expect(ops).toContainEqual({ k: 'image', x: 1, y: 1, src: art('ore'), at: 'center', dim: true });
  });

  it('draws in FreeCol order: terrain, fog, items and overlays, then units', () => {
    const ops = scene(map, tileset);
    const first = (f: (op: Op) => boolean) => ops.findIndex(f);
    const last = (f: (op: Op) => boolean) => ops.findLastIndex(f);
    const fog = (op: Op) => op.k === 'fog';
    const terrain = (op: Op) => op.k === 'image' && op.src === art('plains0');
    const overlay = (op: Op) => op.k === 'image' && op.src === art('hills0');
    const unit = (op: Op) => op.k === 'image' && op.src === art('caravel');
    expect(last(terrain)).toBeLessThan(first(fog));
    expect(last(fog)).toBeLessThan(first(overlay));
    expect(last(overlay)).toBeLessThan(first(unit));
    expect(ops.slice(first(unit))).toEqual([
      { k: 'image', x: 0, y: 0, src: art('caravel'), at: 'unit' },
      { k: 'chip', x: 0, y: 0, text: '-', bg: 0xff8000, fg: 0, stack: 3 },
    ]);
    expect(ops).toContainEqual({ k: 'road', x: 0, y: 3, dirs: [] });
  });
});
