// A Europe screen as the Engine sends it, with the game's own art keys, for the stories.
import type { EuropeUnit, GuiEvents } from './webgui';

const img = (k: string) => [`image.unit.model.unit.${k}`];
const goodsImg = (g: string) => [`image.icon.model.goods.${g}`];
const unit = (id: string, name: string, kind: string, more: Partial<EuropeUnit> = {}): EuropeUnit => ({
  id,
  name,
  images: img(kind),
  selected: false,
  ...more,
});

const caravel = unit('unit:1', 'Caravel', 'caravel', {
  selected: true,
  cargo: [
    { kind: 'goods', id: 'model.goods.tools', name: 'Tools', amount: 100, images: goodsImg('tools') },
    { kind: 'goods', id: 'model.goods.food', name: 'Food', amount: 50, images: goodsImg('food') },
    { kind: 'unit', id: 'unit:9', name: 'Free Colonist', amount: 1, images: img('freeColonist') },
  ],
});

/** [id, art, name, sell, buy, boycotted] */
const goods: [string, string, string, number, number, boolean?][] = [
  ['food', 'food', 'Food', 1, 2],
  ['sugar', 'sugar', 'Sugar', 4, 5],
  ['tobacco', 'tobacco', 'Tobacco', 4, 5],
  ['cotton', 'cotton', 'Cotton', 4, 5],
  ['furs', 'furs', 'Furs', 3, 4],
  ['lumber', 'lumber', 'Lumber', 1, 2],
  ['ore', 'ore', 'Ore', 3, 4],
  ['silver', 'silver', 'Silver', 14, 15],
  ['horses', 'horses', 'Horses', 2, 3],
  ['rum', 'rum', 'Rum', 5, 6, true],
  ['cigars', 'cigars', 'Cigars', 6, 7],
  ['coats', 'coats', 'Coats', 6, 7],
  ['tradeGoods', 'tradeGoods', 'Trade Goods', 3, 4],
  ['tools', 'tools', 'Tools', 3, 4],
  ['muskets', 'muskets', 'Muskets', 2, 3],
];

export const europe: GuiEvents['europe'] = {
  title: 'Europe',
  gold: 1234,
  goldLabel: 'Gold',
  tally: {
    heading: 'Trade Advisor',
    tax: 20,
    taxLabel: 'Tax',
    unitsSold: 'Units bought or sold',
    beforeTaxes: 'Income before taxes',
    afterTaxes: 'Income after taxes',
  },
  ok: 'Close',
  headings: {
    toAmerica: 'Sailing to America',
    toEurope: 'Sailing to Europe',
    inPort: 'In port',
    docks: 'Docks',
    cargo: 'Cargo',
  },
  toAmerica: [unit('unit:3', 'Merchantman', 'merchantman')],
  toEurope: [unit('unit:5', 'Galleon', 'galleon')],
  inPort: [caravel, unit('unit:2', 'Frigate', 'frigate')],
  docks: [
    unit('unit:4', 'Expert Farmer', 'expertFarmer'),
    unit('unit:6', 'Indentured Servant', 'indenturedServant'),
    unit('unit:7', 'Petty Criminal', 'pettyCriminal'),
  ],
  selected: 'unit:1',
  buttons: { train: 'Train', purchase: 'Purchase', recruit: 'Recruit', sail: 'Set sail' },
  recruit: {
    heading: 'Recruit',
    text: 'Click on a unit to recruit it for 200 gold (1 turns)',
    price: 200,
    units: [
      { index: 0, name: 'Expert Fisherman', images: img('expertFisherman'), enabled: true },
      { index: 1, name: 'Free Colonist', images: img('freeColonist'), enabled: true },
      { index: 2, name: 'Expert Farmer', images: img('expertFarmer'), enabled: true },
    ],
  },
  train: {
    heading: 'Train',
    units: [
      {
        id: 'model.unit.masterCarpenter',
        name: 'Master Carpenter',
        images: img('masterCarpenter'),
        price: 500,
        priceLabel: '500 gold',
        enabled: true,
      },
      {
        id: 'model.unit.masterGunsmith',
        name: 'Master Gunsmith',
        images: img('masterGunsmith'),
        price: 3000,
        priceLabel: '3000 gold',
        enabled: false,
      },
    ],
  },
  purchase: {
    heading: 'Purchase',
    units: [
      {
        id: 'model.unit.galleon',
        name: 'Galleon',
        images: img('galleon'),
        price: 1000,
        priceLabel: '1000 gold',
        enabled: true,
      },
      {
        id: 'model.unit.caravel',
        name: 'Caravel',
        images: img('caravel'),
        price: 300,
        priceLabel: '300 gold',
        enabled: true,
      },
    ],
  },
  market: goods.map(([id, art, name, sell, buy, boycotted]) => ({
    id: `model.goods.${id}`,
    name,
    images: goodsImg(art),
    sell,
    buy,
    enabled: !boycotted,
    reason: boycotted ? 'The Crown is boycotting these goods until you have paid your tax arrears of 100 gold.' : null,
    sold: id === 'food' || id === 'tools' ? 40 : 0,
    beforeTaxes: id === 'food' || id === 'tools' ? 100 : 0,
    afterTaxes: id === 'food' || id === 'tools' ? 80 : 0,
  })),
};
