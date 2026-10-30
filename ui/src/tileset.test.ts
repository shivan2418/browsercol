import { describe, expect, it } from 'vite-plus/test';
import { resources } from './resources';
import { overlay, scene, type Chips, type MapView, type Op } from './tileset';

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
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
    { id: 'model.tile.hills', land: true, forested: false, name: 'Hills' },
  ],
  tiles: 'AB' + 'AC' + '.A' + 'AA',
  seen: '11' + '10' + '01' + '11',
  owners: '........',
  players: [],
  rivers: [],
  roads: [[0, 3, 150]],
  items: [[1, 1, 400, 'centered', 'image.tileitem.model.resource.ore']],
  settlements: [],
  units: [
    {
      x: 0,
      y: 0,
      keys: ['image.unit.model.unit.caravel.dutch', 'image.unit.model.unit.caravel'],
      rgb: 0xff8000,
      chip: '-',
      fg: 0,
      stack: 3,
      fade: false,
    },
  ],
  active: [0, 0],
  activeUnit: null,
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
image.settlement.colony=resources/colony.png
image.tile.unitSelect=resources/unitSelect.png
image.tile.tileSelect=resources/tileSelect.png
indianSettlementChip.capital="*"
indianSettlementChip.normal="-"
indianAlarmChip.scouted="!"
indianAlarmChip.contacted="-"
cross="\\u271d"
color.map.road=urn:color:0x804000
color.map.productionBonus.-1=urn:color:orange
color.map.productionBonus.2=urn:color:blue
color.foreground.mission.normal=urn:color:darkGray
color.foreground.mission.expert=urn:color:black
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
  'colony',
  'unitSelect',
  'tileSelect',
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
    expect(ops).toContainEqual({ k: 'road', x: 0, y: 3, dirs: [], color: 0x804000 });
  });
});

describe('colony labels', () => {
  // A colony of 3 at (0,3) with a caravel in front, as FreeCol's classic labels draw it.
  const colony = (x: number, y: number, bonus = -1, sizeChange = 0): MapView => ({
    ...map,
    settlements: [
      {
        x,
        y,
        keys: ['image.settlement.colony'],
        rgb: 0xff8000,
        name: 'Jamestown',
        population: 3,
        bonus,
        sizeChange,
        chips: null,
      },
    ],
    units: [{ x, y, keys: ['image.unit.model.unit.caravel'], rgb: 0xff8000, chip: '-', fg: 0, stack: 1, fade: false }],
  });
  const index = (ops: Op[], k: Op['k'], src?: string) =>
    ops.findIndex((op) => op.k === k && (!src || (op.k === 'image' && op.src === src)));

  it('paints the population with the colony, under the units, and the name over them', () => {
    const ops = at(scene(colony(0, 3), tileset), 0, 3);
    expect(ops[index(ops, 'population')]).toEqual({ k: 'population', x: 0, y: 3, population: 3, color: 0xffc800 });
    expect(index(ops, 'image', art('colony'))).toBeLessThan(index(ops, 'population'));
    expect(index(ops, 'population')).toBeLessThan(index(ops, 'image', art('caravel')));
    expect(index(ops, 'chip')).toBeLessThan(index(ops, 'label'));
    expect(ops[index(ops, 'label')]).toEqual({ k: 'label', x: 0, y: 3, name: 'Jamestown', rgb: 0xff8000 });
  });

  it('dims the population and the name on a tile the player cannot see now', () => {
    // (1,1) is explored but out of sight; (0,3) is in sight.
    const labels = (ops: Op[]) => ops.filter((op) => op.k === 'population' || op.k === 'label');
    expect(labels(at(scene(colony(1, 1), tileset), 1, 1)).map((op) => op.dim)).toEqual([true, true]);
    expect(labels(at(scene(colony(0, 3), tileset), 0, 3)).map((op) => op.dim)).toEqual([undefined, undefined]);
  });

  it('emphasises the population when the colony would rather grow, whatever its bonus', () => {
    const population = (m: MapView) => scene(m, tileset).find((op) => op.k === 'population');
    expect(population(colony(0, 3, -1, 1))).toMatchObject({ color: 0xffc800, emph: true });
    const plain = population(colony(0, 3, 2, 0));
    expect(plain).toMatchObject({ color: 0x0000ff });
    expect(plain).not.toHaveProperty('emph');
  });
});

describe('native settlement chips', () => {
  // A capital in light tan, with a dark red mission, at (0,3) in sight.
  const village = (x: number, y: number, chips: Chips): MapView => ({
    ...map,
    settlements: [
      {
        x,
        y,
        keys: ['image.settlement.colony'],
        rgb: 0xc0a080,
        name: 'Onondaga',
        population: -1,
        bonus: 0,
        sizeChange: 0,
        chips,
      },
    ],
    units: [],
  });
  const contacted: Chips = {
    capital: true,
    fg: 0x000000,
    mission: { rgb: 0x800000, expert: false },
    alarm: { fg: 0xffffff, worthScouting: true },
  };
  const chipsOf = (m: MapView, res = tileset) => scene(m, res).filter((op) => op.k === 'chips');

  it('draws the settlement, mission and alarm chips after the settlement, in that order', () => {
    const ops = at(scene(village(0, 3, contacted), tileset), 0, 3);
    const chips = ops.findIndex((op) => op.k === 'chips');
    expect(ops[chips]).toEqual({
      k: 'chips',
      x: 0,
      y: 3,
      chips: [
        // The Engine's text colour on the owner's; a gray cross for a non-expert.
        { text: '*', bg: 0xc0a080, fg: 0x000000 },
        { text: '\u271d', bg: 0x800000, fg: 0x404040 },
        { text: '-', bg: 0xc0a080, fg: 0xffffff },
      ],
    });
    expect(ops.findIndex((op) => op.k === 'image' && op.at === 'large')).toBe(chips - 1);
    expect(chips).toBeLessThan(ops.findIndex((op) => op.k === 'label'));
  });

  it('shows a black cross for an expert, "!" once scouted, and no alarm before contact', () => {
    const scouted = { ...contacted, mission: { rgb: 0x800000, expert: true }, alarm: { fg: 0, worthScouting: false } };
    expect(chipsOf(village(0, 3, scouted))[0]).toMatchObject({
      chips: [{ text: '*' }, { text: '\u271d', fg: 0x000000 }, { text: '!' }],
    });
    expect(chipsOf(village(0, 3, { capital: false, fg: 0, mission: null, alarm: null }))[0]).toMatchObject({
      chips: [{ text: '-' }],
    });
  });

  it("takes the cross's colour from the Tileset, else Java's gray or black", () => {
    const cyan = { dir: 'mods/test', props: 'color.foreground.mission.normal=urn:color:0x00ffff\n' };
    const cross = (res: typeof tileset, expert: boolean, fg: number) =>
      expect(chipsOf(village(0, 3, { ...contacted, mission: { rgb: 0x800000, expert } }), res)[0]).toMatchObject({
        chips: [{}, { text: '\u271d', fg }, {}],
      });
    cross(resources([{ dir: 'default', props }, cyan], files), false, 0x00ffff);
    const bare = resources([{ dir: 'default', props: props.replace(/^color\.foreground\..*$/gm, '') }], files);
    cross(bare, false, 0x808080);
    cross(bare, true, 0x000000);
  });

  it('dims the chips on a tile out of sight, and colonies have none', () => {
    expect(chipsOf(village(1, 1, contacted))[0]).toHaveProperty('dim', true);
    expect(chipsOf(village(0, 3, contacted))[0]).not.toHaveProperty('dim');
    const colony = { x: 0, y: 3, keys: ['image.settlement.colony'], rgb: 0, name: 'J' };
    const settlements = [{ ...colony, population: 1, bonus: 0, sizeChange: 0, chips: null }];
    expect(chipsOf({ ...map, settlements })).toEqual([]);
  });
});

describe('overlay', () => {
  it("draws MapViewer's cursor for the view mode, centred on its tile", () => {
    expect(overlay({ at: [1, 0], kind: 'unit' }, null, tileset)).toEqual([
      { k: 'image', x: 1, y: 0, src: art('unitSelect'), at: 'center' },
    ]);
    expect(overlay({ at: [0, 1], kind: 'tile' }, null, tileset)).toEqual([
      { k: 'image', x: 0, y: 1, src: art('tileSelect'), at: 'center' },
    ]);
    expect(overlay(null, null, tileset)).toEqual([]);
  });

  it("draws the active unit's path over the cursor: the lines, then a mark per step", () => {
    const path: ([number, number, number] | null)[] = [
      [1, 0, 0],
      [1, 1, 0],
      [1, 2, 1],
    ];
    const ops = overlay({ at: [1, 0], kind: 'unit' }, path, tileset);
    expect(ops.slice(1)).toEqual([
      { k: 'pathLine', x: 1, y: 0, to: [1, 1], turns: 0 },
      { k: 'pathLine', x: 1, y: 1, to: [1, 2], turns: 1 },
      { k: 'pathMark', x: 1, y: 0, turns: 0 },
      { k: 'pathMark', x: 1, y: 1, turns: 0 },
      { k: 'pathMark', x: 1, y: 2, turns: 1 },
    ]);
  });

  it('draws no path of one step, and breaks the line where a step has no tile', () => {
    expect(overlay(null, [[1, 0, 0]], tileset)).toEqual([]);
    // Sailing to Europe and back: the step in Europe has no tile.
    const ops = overlay(null, [[1, 0, 0], null, [1, 2, 3]], tileset);
    expect(ops).toEqual([
      { k: 'pathMark', x: 1, y: 0, turns: 0 },
      { k: 'pathMark', x: 1, y: 2, turns: 3 },
    ]);
  });
});
