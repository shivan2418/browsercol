import { describe, expect, it } from 'vite-plus/test';
import {
  EVENT_KEYS,
  isArtKey,
  isMapKey,
  isPanelKey,
  MAP_KEY_FAMILIES,
  MAP_KEYS,
  PANEL_KEY_FAMILIES,
  PANEL_KEYS,
} from './map-keys';
import { resources, type Resources } from './resources';
import { overlay, scene, type MapView } from './tileset';

// A map with water, land, a forest, a river, a road, a colony and a native
// settlement, so the scene asks for every kind of key it draws.
// FreeCol's grid is staggered: odd rows half a tile to the right.
//   row 0:  P  O  P  P        P plains, O ocean, F forest, . unexplored
//   row 1:    F  P  O  O
//   row 2:  P  O  P  P
//   row 3:    P  P  P  .
const map: MapView = {
  w: 4,
  h: 4,
  turn: 'Spring 1492',
  turnLabel: 'Spring 1492',
  nation: 'model.nation.dutch',
  statusLine: 'Score: 0    ✧    Gold: 1000    ✧    Tax: 0%    ✧    Year: Spring 1492',
  ourTurn: true,
  types: [
    { id: 'model.tile.plains', land: true, forested: false, name: 'Plains' },
    { id: 'model.tile.ocean', land: false, forested: false, name: 'Ocean' },
    { id: 'model.tile.forest', land: true, forested: true, name: 'Forest' },
  ],
  tiles: 'ABAA' + 'CABB' + 'ABAA' + 'AAA.',
  seen: '1111' + '1111' + '1111' + '1110',
  owners: '................',
  players: [],
  // The forest at (0,1) has a river flowing NE, into the ocean at (1,0).
  rivers: [[0, 1, 1, '1000', '0100']],
  roads: [
    [0, 2, 150],
    [0, 3, 150],
  ],
  items: [[3, 0, 400, 'centered', 'image.tileitem.model.resource.ore']],
  settlements: [
    {
      x: 1,
      y: 1,
      keys: ['image.tileitem.model.settlement.colony.small.british'],
      rgb: 0xff8000,
      name: 'Jamestown',
      population: 3,
      bonus: 2,
      sizeChange: 0,
      chips: null,
    },
    {
      x: 2,
      y: 2,
      keys: ['image.tileitem.model.settlement.native'],
      rgb: 0xc0a080,
      name: 'Onondaga',
      population: -1,
      bonus: 0,
      sizeChange: 0,
      chips: {
        capital: true,
        fg: 0x000000,
        mission: { rgb: 0x800000, expert: false },
        alarm: { fg: 0xffffff, worthScouting: true },
      },
    },
  ],
  units: [
    {
      x: 0,
      y: 3,
      keys: ['image.unit.model.unit.caravel.dutch'],
      rgb: 0xff8000,
      chip: '-',
      fg: 0,
      stack: 1,
      fade: false,
    },
  ],
  active: [0, 3],
  activeUnit: null,
};

const props = `
image.mask=resources/mask.png
image.mask.ne=resources/mask-ne.png
image.mask.nw=resources/mask-nw.png
image.mask.se=resources/mask-se.png
image.mask.sw=resources/mask-sw.png
image.mask.beach.sw_e=resources/beach-sw-e.png
image.mask.beach.nw_sw=resources/beach-nw-sw.png
image.mask.beach.ne_nw_se_sw=resources/beach-ne-nw-se-sw.png
image.mask.special.beach.ne=resources/special-beach-ne.png
image.mask.special.beach.sw=resources/special-beach-sw.png
image.mask.river.delta.sw=resources/delta-sw.png
image.mask.river.delta.pebbles.sw=resources/delta-pebbles-sw.png
image.mask.river.minor.ne=resources/river-minor-ne.png
image.mask.river.to_major.ne=resources/river-to-major-ne.png
image.tile.model.tile.plains.center=resources/plains0.png
image.tile.model.tile.ocean.center=resources/ocean0.png
image.tile.model.tile.forest.center=resources/forest0.png
image.tile.model.tile.beach=resources/beach0.png
image.tile.river.water=resources/river-water.png
image.tile.river.pebbles=resources/river-pebbles.png
image.tile.model.tile.unexplored.center=resources/unexplored0.png
image.tile.model.tile.unexplored.border.E=resources/border-e.png
image.tile.model.tile.unexplored.border.S=resources/border-s.png
image.tileoverlay.model.tile.plains=resources/overlay-plains.png
image.tileforest.model.tile.forest=resources/forest.png
image.tileforest.model.tile.forest.s0100=resources/forest-s0100.png
image.abovetile.model.tile.plains=resources/above-plains.png
image.tileitem.model.resource.ore=resources/ore.png
image.tileitem.model.settlement.colony.small.british=resources/colony.png
image.tileitem.model.settlement.native=resources/native.png
image.unit.model.unit.caravel.dutch=resources/caravel.png
image.tile.unitSelect=resources/unitSelect.png
image.tile.tileSelect=resources/tileSelect.png
indianSettlementChip.capital="*"
indianSettlementChip.normal="-"
indianAlarmChip.scouted="!"
indianAlarmChip.contacted="-"
cross="\\u271d"
color.map.road=urn:color:0x804000
color.map.productionBonus.2=urn:color:blue
color.foreground.mission.normal=urn:color:darkGray
color.foreground.mission.expert=urn:color:black
`;
const tileset = resources([{ dir: 'default', props }], []);

/** The resources, with every key the map asks for written down. */
const watching = (res: Resources) => {
  const keys = new Set<string>();
  const note = <T>(key: string, value: T): T => {
    keys.add(key);
    return value;
  };
  const watched: Resources = {
    has: (key) => note(key, res.has(key)),
    variations: (key) => note(key, res.variations(key)),
    path: (key, variation) => note(key, res.path(key, variation)),
    forSeed: (key, seed) => note(key, res.forSeed(key, seed)),
    string: (key) => note(key, res.string(key)),
    color: (key, replacement) => note(key, res.color(key, replacement)),
  };
  return { keys, res: watched };
};

describe('the map keys', () => {
  /** The keys the map asks for, drawing the map above. */
  const asked = () => {
    const { keys, res } = watching(tileset);
    scene(map, res);
    overlay({ at: [0, 3], kind: 'unit' }, null, res);
    overlay({ at: [0, 3], kind: 'tile' }, null, res);
    return keys;
  };

  it('asks for no key the art build leaves out', () => {
    expect([...asked()].filter((key) => !isMapKey(key))).toEqual([]);
  });

  it('asks for a key of every family the list holds', () => {
    const keys = asked();
    const unused = Object.entries(MAP_KEY_FAMILIES)
      .filter(([, prefix]) => ![...keys].some((key) => key.startsWith(prefix)))
      .map(([name]) => name);
    expect(unused).toEqual([]);
    const alone = Object.entries(MAP_KEYS)
      .filter(([, key]) => !keys.has(key))
      .map(([name]) => name);
    expect(alone).toEqual([]);
  });
});

describe('the panel keys', () => {
  it('are the art of what a message is about, of the event panel, the colony panel and the fathers, and nothing else', () => {
    for (const key of [
      'image.icon.coin',
      'image.icon.model.goods.food',
      'image.buildingicon.model.building.townHall',
      'image.miscicon.model.nation.dutch',
      'image.flavor.event.firstLanding',
      'image.flavor.event.discoverPacific',
      'image.flavor.model.foundingFather.adamSmith',
    ]) {
      expect(isPanelKey(key), key).toBe(true);
      expect(isMapKey(key), `the map does not draw ${key}`).toBe(false);
    }
    for (const key of [
      'image.icon.Colopedia.idea',
      'image.flavor.Title',
      'image.flavor.event.meeting.natives',
      'image.flavor.model.foundingFather.trade',
      'image.flavor.model.foundingFather.religious',
      'image.background.FreeColPanel',
    ]) {
      expect(isArtKey(key), key).toBe(false);
    }
  });

  it('are each a family or key of the lists, which the art build ships with the map keys', () => {
    expect(Object.keys(PANEL_KEY_FAMILIES)).toEqual(['goods', 'building', 'nation', 'father']);
    expect(EVENT_KEYS).toHaveLength(2);
    expect(Object.keys(PANEL_KEYS)).toEqual(['coin']);
    expect(isArtKey('image.unit.model.unit.caravel')).toBe(true);
  });
});
