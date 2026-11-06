// A colony as the Engine sends it, for the colony panel's tests and its stories.
import type { ColonyView } from './webgui';

export const colonist = (id: string) => ({
  id,
  name: 'Dutch Free Colonist',
  keys: ['image.unit.model.unit.freeColonist.dutch', 'image.unit.model.unit.freeColonist'],
});
export const goods = (type: string, amount: number) => ({
  type: `model.goods.${type}`,
  name: type[0].toUpperCase() + type.slice(1),
  keys: [`image.icon.model.goods.${type}`],
  amount,
});
export const tile = (x: number, y: number, more: Partial<ColonyView['tiles'][number]> = {}) => ({
  id: `colonyTile:${x}${y}`,
  pos: [x, y] as [number, number],
  at: [10 + y - x, 20 + x + y] as [number, number],
  name: 'Plains',
  terrain: ['image.tile.model.tile.plains.center'],
  forest: null,
  centre: false,
  ours: true,
  taken: false,
  natives: false,
  workers: [],
  production: [],
  ...more,
});

export const jamestown: ColonyView = {
  id: 'colony:1',
  name: 'Jamestown',
  at: [3, 4],
  ok: 'OK',
  population: {
    size: 1,
    sizeChange: '+0',
    rebelPercent: 0,
    tip: {
      members: [
        ['Rebel:', '0', '0%'],
        ['Royalist:', '1', '100%'],
      ],
      liberty: [{ type: 'model.goods.bells', name: 'Bells', keys: [], amount: 1 }],
      bar: { keys: [], value: 32, step: 1, max: 200, text: '32+1/200 (Turns: 168)' },
      turns: [
        ['Turns to increase rebels', '168'],
        ['Add colonists at current bonus', '1'],
      ],
    },
  },
  buildings: [
    {
      id: 'building:1',
      type: 'model.building.townHall',
      name: 'Town Hall',
      keys: ['image.buildingicon.model.building.townHall'],
      site: false,
      capacity: 3,
      builds: false,
      workers: [],
      production: { ...goods('bells', 1), max: 1 },
      upkeep: null,
      tip: { input: null, output: { ...goods('bells', 1), max: 1 }, workers: [], breeding: null },
    },
    {
      id: 'building:2',
      type: 'model.building.carpenterHouse',
      name: "Carpenter's house",
      keys: ['image.buildingicon.model.building.carpenterHouse'],
      site: false,
      capacity: 3,
      builds: true,
      workers: [colonist('unit:2')],
      production: { ...goods('hammers', 3), max: 6 },
      upkeep: 5,
      // Short of lumber: 3 of the 6 it needs.
      tip: {
        input: { ...goods('lumber', 3), max: 6 },
        output: { ...goods('hammers', 3), max: 6 },
        workers: [{ ...colonist('unit:2'), made: goods('hammers', 3), progress: null, student: null }],
        breeding: null,
      },
    },
    {
      id: null,
      type: 'model.building.schoolhouse',
      name: 'Schoolhouse',
      keys: ['image.buildingicon.model.building.BuildingSite'],
      site: true,
      capacity: 0,
      builds: false,
      workers: [],
      production: null,
      upkeep: null,
      tip: null,
    },
  ],
  tiles: [
    tile(0, 0),
    tile(1, 1, { centre: true, production: [goods('grain', 5), goods('cotton', 2)] }),
    tile(2, 1, {
      workers: [
        {
          ...colonist('unit:1'),
          occupation: 'F',
          work: 'model.goods.grain',
          choices: [goods('grain', 3), goods('cotton', 2)],
        },
      ],
      production: [goods('grain', 3)],
    }),
    tile(2, 2, { ours: false, taken: true }),
    tile(0, 2, { natives: true }),
  ],
  production: [goods('food', 4), goods('lumber', -3)],
  warehouse: { title: 'Warehouse', capacity: 100, goods: [{ ...goods('lumber', 150), over: true }] },
  outside: { title: 'Outside Colony', units: [colonist('unit:3')] },
  inPort: { title: 'In Port', units: [], selected: null, cargo: 'Cargo on carrier' },
  construction: {
    type: 'model.building.warehouse',
    name: 'Warehouse',
    keys: ['image.buildingicon.model.building.warehouse'],
    required: [{ ...goods('hammers', 80), needed: 80, available: 20, produced: 3, turns: '(Turns: 20)' }],
  },
  nothing: 'Click on the building site to select a building or unit to build.',
  queue: {
    title: 'Build Queue',
    buildingsTitle: 'Buildings',
    unitsTitle: 'Units',
    showAll: 'Show all',
    compact: 'Compact view',
    queue: [
      {
        type: 'model.building.warehouse',
        name: 'Warehouse',
        keys: ['image.buildingicon.model.building.warehouse'],
        required: [goods('hammers', 80)],
        reason: null,
      },
    ],
    buildings: [
      {
        type: 'model.building.stockade',
        name: 'Stockade',
        keys: ['image.buildingicon.model.building.stockade'],
        required: [goods('hammers', 64)],
        reason: null,
      },
      {
        type: 'model.building.university',
        name: 'University',
        keys: ['image.buildingicon.model.building.university'],
        required: [goods('hammers', 200)],
        reason: 'Requires: College',
      },
    ],
    units: [
      {
        type: 'model.unit.wagonTrain',
        name: 'Wagon Train',
        keys: ['image.unit.model.unit.wagonTrain'],
        required: [goods('hammers', 40)],
        reason: null,
      },
    ],
    buy: { label: 'Buy Warehouse', price: 210, enabled: true },
  },
};
