// PROTOTYPE (#48), throwaway: the mock content every look variant draws.
// The numbers are made up but sized like a turn-40 classic game.

const urls = import.meta.glob<string>('./art/*.png', { eager: true, query: '?url', import: 'default' });
/** An art file's URL by its short name, e.g. art('g-food'). */
export const art = (name: string) => urls[`./art/${name}.png`] ?? '';
export const goodArt = (g: string) => art(`g-${g}`);
export const unitArt = (u: string) => art(`u-${u}`);

export const GOOD_NAMES: Record<string, string> = {
  food: 'Food',
  grain: 'Grain',
  fish: 'Fish',
  sugar: 'Sugar',
  tobacco: 'Tobacco',
  cotton: 'Cotton',
  furs: 'Furs',
  lumber: 'Lumber',
  ore: 'Ore',
  silver: 'Silver',
  horses: 'Horses',
  rum: 'Rum',
  cigars: 'Cigars',
  cloth: 'Cloth',
  coats: 'Coats',
  tradeGoods: 'Trade goods',
  tools: 'Tools',
  muskets: 'Muskets',
  hammers: 'Hammers',
  bells: 'Liberty bells',
  crosses: 'Crosses',
};

export const UNIT_NAMES: Record<string, string> = {
  freeColonist: 'Free Colonist',
  expertFarmer: 'Expert Farmer',
  expertFisherman: 'Expert Fisherman',
  expertFurTrapper: 'Expert Fur Trapper',
  expertLumberJack: 'Expert Lumberjack',
  elderStatesman: 'Elder Statesman',
  indenturedServant: 'Indentured Servant',
  pettyCriminal: 'Petty Criminal',
  firebrandPreacher: 'Firebrand Preacher',
  masterCarpenter: 'Master Carpenter',
};

export type Amount = [good: string, n: number];

// --- The side panel -------------------------------------------------------

export const side = {
  turn: 41,
  year: 'Autumn 1512',
  gold: 1240,
  tax: 4,
  score: 86,
  nation: 'Dutch',
  unit: { name: 'Dutch Pioneer', detail: 'Free Colonist, 100 Tools', moves: '1/1', img: 'freeColonist' },
  tile: { name: 'Mixed Forest', owner: 'New Amsterdam (Dutch)', produce: [['lumber', 6], ['furs', 3]] as Amount[] },
  buttons: [
    ['Next unit', 'W'],
    ['Build colony', 'B'],
    ['End turn', 'Enter'],
  ],
  orders: [
    ['Fortify', 'F'],
    ['Sentry', 'S'],
    ['Skip', 'Space'],
    ['Plow', 'P'],
    ['Road', 'R'],
    ['Clear forest', 'C'],
    ['Go to', 'H'],
    ['Disband', 'D'],
  ],
  saves: [
    { name: 'Autosave', when: 'Today 14:02', turn: 41, year: 'Autumn 1512' },
    { name: 'Before the Arawak war', when: 'Yesterday 21:40', turn: 33, year: 'Spring 1509' },
  ],
};

// --- A choice dialog: a scout at a native settlement ------------------------

export const choice = {
  title: 'Arawak village',
  img: 'u-scout',
  img2: 's-village',
  text: 'Your Seasoned Scout has arrived at the Arawak village of Guanahaní. The village is wary but has not turned you away. What would you like to do?',
  options: [
    { label: 'Speak with the chief', hint: 'May reveal nearby land, or a gift of gold' },
    { label: 'Demand tribute', hint: 'Angers the tribe' },
    { label: 'Attack the village', hint: 'Declares war on the Arawaks' },
    { label: 'Leave', hint: '', cancel: true },
  ],
};

// --- The colony panel ------------------------------------------------------

export interface ColonyTile {
  terrain: string;
  name: string;
  forest?: boolean;
  worker?: string;
  produce: Amount[];
  centre?: boolean;
  /** Not ours to use. */
  owned?: string;
}

export interface Building {
  name: string;
  img: string;
  workers: string[];
  slots: number;
  out: Amount[];
  /** What it uses up each turn. */
  in?: Amount[];
  /** Production the building could make with the input it lacks. */
  max?: number;
  note?: string;
}

export const colony = {
  name: 'New Amsterdam',
  population: 6,
  rebels: 41,
  tories: 59,
  bonus: '+0',
  defence: 'Stockade, 1 Soldier',
  // A 3x3 ring around the colony centre, in reading order.
  tiles: [
    { terrain: 'ocean', name: 'Ocean', worker: 'expertFisherman', produce: [['fish', 6]] },
    { terrain: 'grassland', name: 'Mixed Forest', forest: true, worker: 'expertFurTrapper', produce: [['furs', 6]] },
    { terrain: 'hills', name: 'Hills', produce: [['ore', 4]], owned: 'Arawak' },
    { terrain: 'ocean', name: 'Ocean', produce: [['fish', 4]] },
    { terrain: 'plains', name: 'Plains', centre: true, produce: [['grain', 5], ['cotton', 3]] },
    { terrain: 'grassland', name: 'Grassland', worker: 'expertFarmer', produce: [['grain', 8]] },
    { terrain: 'ocean', name: 'Ocean', produce: [['fish', 4]] },
    { terrain: 'plains', name: 'Plains', produce: [['grain', 5]] },
    { terrain: 'prairie', name: 'Prairie', forest: true, worker: 'expertLumberJack', produce: [['lumber', 8]] },
  ] as ColonyTile[],
  buildings: [
    { name: 'Town hall', img: 'townhall', workers: ['elderStatesman'], slots: 3, out: [['bells', 7]] },
    {
      name: "Carpenter's house",
      img: 'carpenters_house',
      workers: ['freeColonist'],
      slots: 3,
      out: [['hammers', 3]],
      in: [['lumber', 3]],
    },
    {
      name: "Fur trader's house",
      img: 'fur_traders_house',
      workers: ['indenturedServant'],
      slots: 3,
      out: [['coats', 3]],
      in: [['furs', 3]],
    },
    { name: "Blacksmith's house", img: 'blacksmiths_house', workers: [], slots: 3, out: [['tools', 0]], in: [['ore', 0]] },
    { name: "Weaver's house", img: 'weavers_house', workers: [], slots: 3, out: [['cloth', 0]], in: [['cotton', 0]] },
    { name: 'Chapel', img: 'chapel', workers: [], slots: 0, out: [['crosses', 1]] },
    { name: 'Docks', img: 'docks', workers: [], slots: 0, out: [], note: 'Lets colonists fish' },
    { name: 'Stockade', img: 'stockade', workers: [], slots: 0, out: [], note: 'Defence +100%' },
  ] as Building[],
  // [good, in store, net per turn]
  warehouse: [
    ['food', 87, 6],
    ['sugar', 0, 0],
    ['tobacco', 0, 0],
    ['cotton', 46, 3],
    ['furs', 112, 3],
    ['lumber', 38, 5],
    ['ore', 0, 0],
    ['silver', 0, 0],
    ['horses', 26, 1],
    ['rum', 0, 0],
    ['cigars', 0, 0],
    ['cloth', 0, 0],
    ['coats', 64, 3],
    ['tradeGoods', 0, 0],
    ['tools', 52, 0],
    ['muskets', 50, 0],
  ] as [string, number, number][],
  capacity: 100,
  // How the food is spent.
  food: { made: 19, eaten: 12, horses: 1, toGrowth: [87, 200] as [number, number] },
  building: { name: 'Schoolhouse', hammers: [38, 64] as [number, number], tools: [52, 30] as [number, number], turns: 9 },
  queue: ['Lumber mill', 'Printing press'],
  outside: [
    { unit: 'soldier', name: 'Veteran Soldier', state: 'Fortified' },
    { unit: 'pettyCriminal', name: 'Petty Criminal', state: 'Sentry' },
  ],
};

// --- Europe ---------------------------------------------------------------

export const europe = {
  gold: 1240,
  tax: 4,
  // [good, sell price, buy price, trend]
  market: [
    ['food', 1, 8, 0],
    ['sugar', 3, 5, 0],
    ['tobacco', 5, 7, 1],
    ['cotton', 2, 4, -1],
    ['furs', 4, 6, -1],
    ['lumber', 1, 2, 0],
    ['ore', 5, 6, 0],
    ['silver', 19, 20, 0],
    ['horses', 1, 2, 0],
    ['rum', 10, 11, 0],
    ['cigars', 11, 12, 1],
    ['cloth', 10, 11, 0],
    ['coats', 9, 10, -1],
    ['tradeGoods', 1, 2, 0],
    ['tools', 1, 2, 0],
    ['muskets', 3, 4, 1],
  ] as [string, number, number, number][],
  ships: [
    {
      name: 'Caravel “Halve Maen”',
      img: 'caravel',
      state: 'In port',
      cargo: [['coats', 100], ['furs', 64]] as Amount[],
      units: ['expertFarmer'],
      holds: 2,
    },
    { name: 'Merchantman “Duyfken”', img: 'merchantman', state: 'Sailing to the New World, 2 turns', cargo: [], units: [], holds: 4 },
  ],
  docks: ['freeColonist', 'pettyCriminal'],
  recruits: [
    { unit: 'expertFisherman', price: 588 },
    { unit: 'freeColonist', price: 588 },
    { unit: 'firebrandPreacher', price: 588 },
  ],
  train: [
    { unit: 'expertFarmer', price: 1100 },
    { unit: 'masterCarpenter', price: 1300 },
    { unit: 'elderStatesman', price: 1900 },
    { unit: 'firebrandPreacher', price: 1500 },
  ],
};

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
export const money = (n: number) => n.toLocaleString('en-US');

/** The map behind every look: a screenshot of the real map, on its ocean colour. */
export const mapStyle = {
  background: `#1d4357 url(${art('backdrop')}) no-repeat center / contain`,
} as const;

/** A colony tile's art, layered as a CSS background: forest or hills over the ground, or the colony itself. */
export function tileBg(t: { terrain: string; forest?: boolean; centre?: boolean }) {
  const layers = t.centre
    ? [art('s-colony'), art('t-plains')]
    : t.forest
      ? [art('f-broadleaf'), art(`t-${t.terrain}`)]
      : t.terrain === 'hills'
        ? [art('t-hills'), art('t-plains')]
        : [art(`t-${t.terrain}`)];
  return layers.map((u) => `url(${u}) center / contain no-repeat`).join(', ');
}
