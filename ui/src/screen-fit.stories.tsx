// The windows players use most, each as the game opens it (through the same DialogHost, with the game's own art),
// for the screen-fit check (#503, scripts/screen-fit.ts): it loads each story at every common screen size and UI
// scale and checks the window lies on the screen. The tag `screen-fit` is what picks a story for it; a window that
// is added to the game and used a lot belongs here. The UI scale is the `uiZoom` global (.storybook/preview.tsx).
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColonyActions, type ColonyMoves } from './colony-panel';
import { colonist, goods, jamestown } from './colony-fixture';
import { dialogs } from './dialogs';
import { europe } from './europe-fixture';
import { DialogHost } from './panels';
import { PreferencesDialog } from './prefs-dialog';
import { DEFAULTS } from './prefs';
import { art } from './story-art';
import * as tradeRoutes from './trade-routes.stories';
import type { ColonyView, GuiEvents, GuiQuestions, ReportView } from './webgui';

const none = new Proxy({}, { get: () => () => {} }) as never;
const moves = new Proxy({}, { get: () => () => {} }) as ColonyMoves;

/** A question the Engine asks (a short prompt, which stays a centred window on a small screen: compact.ts). */
type Prompt = { [K in 'confirm' | 'choice' | 'input']: ['ask', K, GuiQuestions[K]['ask']] }[
  | 'confirm'
  | 'choice'
  | 'input'];

type Show =
  | Prompt
  | { [K in 'colony' | 'europe' | 'tradeRoutes' | 'report' | 'messages']: [K, GuiEvents[K]] }[
      | 'colony'
      | 'europe'
      | 'tradeRoutes'
      | 'report'
      | 'messages'];

/** A window opened through the page's DialogHost, as the game's dialogs are. */
function Window({ show }: { show: Show }) {
  const box = useMemo(() => {
    const b = dialogs();
    if (show[0] === 'ask') void (b.ask as (kind: string, ask: unknown) => Promise<unknown>)(show[1], show[2]);
    else (b.show as (kind: string, event: unknown) => void)(show[0], show[1]);
    return b;
  }, [show]);
  return (
    <ColonyActions.Provider value={moves}>
      <DialogHost dialogs={box} goTo={() => {}} art={art} report={none} routes={none} />
    </ColonyActions.Provider>
  );
}

const meta: Meta<typeof Window> = { title: 'Screen fit', component: Window, tags: ['screen-fit'] };
export default meta;
type Story = StoryObj<typeof Window>;

const kinds = ['lumber', 'food', 'grain', 'cotton', 'hammers', 'furs', 'sugar', 'tools'];
const ship = (cargoUnits: number) => ({
  id: 'unit:s0',
  name: 'Galleon',
  keys: ['image.unit.model.unit.galleon'],
  cargo: {
    title: 'Cargo',
    units: Array.from({ length: cargoUnits }, (_, i) => colonist(`unit:c${i}`)),
    goods: kinds.slice(0, 4).map((t) => goods(t, 100)),
  },
});

/** A big colony: many buildings, units outside, a ship with cargo in port and a full warehouse. */
const big: ColonyView = {
  ...jamestown,
  name: 'Metropolis',
  buildings: Array.from({ length: 14 }, (_, i) => ({
    ...jamestown.buildings[i % 2],
    id: `building:${i}`,
    type: `model.building.b${i}`,
    name: `Building ${i}`,
  })),
  outside: { title: 'Outside Colony', units: Array.from({ length: 14 }, (_, i) => colonist(`unit:o${i}`)) },
  warehouse: { ...jamestown.warehouse, goods: kinds.map((t) => ({ ...goods(t, 380), over: false })) },
  inPort: { title: 'In Port', units: [ship(8)], selected: 'unit:s0', cargo: 'Cargo' },
};

/** The build queue open: a click on a building that builds, as a player opens it. */
const openQueue: Story['play'] = async ({ canvasElement }) => {
  await new Promise((ok) => setTimeout(ok, 300));
  canvasElement.querySelector<HTMLElement>('.building[data-builds]')?.click();
};

export const ColonyBig: Story = { args: { show: ['colony', big] } };
export const ColonyBigQueue: Story = { args: { show: ['colony', big] }, play: openQueue };
export const ColonySmall: Story = { args: { show: ['colony', jamestown] } };
export const ColonySmallQueue: Story = { args: { show: ['colony', jamestown] }, play: openQueue };

export const Europe: Story = { args: { show: ['europe', europe] } };

const routes = tradeRoutes.default.args!.routes as GuiEvents['tradeRoutes'];
export const TradeRoutes: Story = { args: { show: ['tradeRoutes', routes] } };
/** The editor: the first route picked and Edit pressed. */
export const RouteEditor: Story = {
  args: { show: ['tradeRoutes', routes] },
  play: async ({ canvasElement }) => {
    await new Promise((ok) => setTimeout(ok, 300));
    canvasElement.querySelector<HTMLElement>('[data-route]')?.click();
    await new Promise((ok) => setTimeout(ok, 100));
    canvasElement.querySelector<HTMLElement>('[data-answer=edit]')?.click();
  },
};

/**
 * The editor on a route whose stops have many plan pills: the colony loads four goods and Europe sells them all, so
 * each stop's row is tall, and the rail must still run through it to the stop's pin.
 */
const all = ['model.goods.tools', 'model.goods.furs', 'model.goods.sugar', 'model.goods.food'];
export const RouteEditorMany: Story = {
  args: {
    show: [
      'tradeRoutes',
      {
        ...routes,
        routes: [
          {
            id: 'tradeRoute:9',
            name: 'Main export',
            silent: false,
            units: 1,
            stops: [
              { place: 'colony:7', label: 'New Amsterdam', cargo: [...all, ...all] },
              { place: 'europe:1', label: 'Europe', cargo: [] },
            ],
          },
        ],
      },
    ],
  },
  play: RouteEditor.play,
};

const head = <K extends ReportView['report']>(report: K) => ({ report, title: `Report`, ok: 'OK', back: null });
const unit = { id: 'unit:1', name: 'Free Colonist', keys: ['image.unit.model.unit.freeColonist'] };
const report = (e: ReportView) => ({ show: ['report', e as GuiEvents['report']] }) as { show: Show };

const colonies = Array.from({ length: 16 }, (_, i) => ({
  id: `colony:${i}`,
  name: `Colony ${i}`,
  building: { name: 'Hammers', keys: [], unit: false },
  colonists: Array.from({ length: 8 }, (_, j) => ({ ...unit, id: `unit:${i}-${j}` })),
  outside: [],
  goods: kinds.map((t) => ({ type: `model.goods.${t}`, name: t, keys: [], amount: 3, stock: 40, max: 5 })),
  buildings: Array.from({ length: 8 }, (_, j) => ({ id: `b:${i}-${j}`, name: `Building ${j}`, keys: [] })),
}));
/** The Colony Advisor (the colony report, F3). */
export const ReportColonyAdvisor: Story = { args: report({ ...head('colony'), colonies } as ReportView) };

const father = { description: 'Wise', keys: [], kind: 'Political', turn: null };
const states = ['elected', 'recruiting', 'available'] as const;
/** The Continental Congress report (F6). */
export const ReportCongress: Story = {
  args: report({
    ...head('congress'),
    labels: { recruiting: 'Recruiting', none: 'None' },
    current: {
      id: 'f:2',
      name: 'Jefferson',
      description: 'Wise',
      keys: [],
      cost: 100,
      liberty: 40,
      bars: [
        {
          type: 'model.goods.bells',
          name: 'Bells',
          keys: [],
          amount: 100,
          needed: 100,
          available: 40,
          produced: 6,
          turns: '(Turns: 10)',
        },
      ],
    },
    fathers: Array.from({ length: 25 }, (_, i) => ({
      id: `f:${i}`,
      name: `Father ${i}`,
      ...father,
      kind: ['Political', 'Military', 'Trade', 'Exploration', 'Religious'][i % 5],
      state: states[i % 3],
      status: 'Available',
    })),
  } as ReportView),
};

const goodsRows = kinds.map((t) => ({ type: `model.goods.${t}`, name: t, keys: [], buy: 5, sell: 4 }));
/** The Trade Advisor (the trade report, F9). */
export const ReportTradeAdvisor: Story = {
  args: report({
    ...head('trade'),
    goods: goodsRows,
    labels: {
      unitsSold: 'Units sold',
      beforeTaxes: 'Before taxes',
      afterTaxes: 'After taxes',
      cargoUnits: 'In ships',
      totalUnits: 'Total',
      totalDelta: 'Change',
      hasCustomHouse: '* has a custom house',
    },
    sold: kinds.map(() => 10),
    beforeTaxes: kinds.map(() => 40),
    afterTaxes: kinds.map(() => 36),
    cargo: kinds.map(() => 3),
    total: kinds.map(() => 50),
    delta: kinds.map(() => 4),
    colonies: Array.from({ length: 16 }, (_, i) => ({
      id: `colony:${i}`,
      name: `Colony ${i}`,
      export: true,
      cells: kinds.map(() => ({ amount: 40, production: 5, exported: 100, warning: null })),
    })),
  } as ReportView),
};

const message = (text: string) => ({
  text,
  type: 'DEFAULT',
  source: null,
  tile: null,
  at: null,
  heading: null,
  images: [],
  filter: null,
  filterTip: null,
  ignored: false,
  ignoreTip: null,
});
/** A model message: the information panel, under the advisor. */
export const ModelMessage: Story = {
  args: {
    show: [
      'messages',
      {
        title: '',
        ok: 'OK',
        groupBy: null,
        messages: [message('Your warehouse in Metropolis is full.'), message('The Dutch are a nation.')],
      } as unknown as GuiEvents['messages'],
    ],
  },
};

/** The Preferences window, with BrowserCol's own options (FreeCol's come from the Engine's data). */
export const Preferences: Story = {
  render: () => <PreferencesDialog prefs={DEFAULTS} freecol={null} change={() => {}} close={() => {}} />,
};

/** Short prompts, as FreeCol's confirm, choice and input dialogs: modals on a small screen, never sheets (screen-fit.ts). */
export const PromptConfirm: Story = {
  args: {
    show: [
      'ask',
      'confirm',
      {
        text: 'Do you really want to disband this unit?\nIt will be gone for good.',
        ok: 'Yes',
        cancel: 'No',
        defaultOk: false,
        tile: null,
        object: null,
        header: 'Disband unit',
      },
    ],
  },
};
export const PromptChoiceLong: Story = {
  args: {
    show: [
      'ask',
      'choice',
      {
        text: 'Where to?',
        cancel: 'Cancel',
        tile: null,
        object: null,
        choices: Array.from({ length: 20 }, (_, i) => ({
          text: `Colony ${i}`,
          enabled: true,
          ok: false,
          cancel: false,
          default: i === 0,
          turns: i + 1,
        })),
      },
    ],
  },
};
export const PromptInput: Story = {
  args: {
    show: [
      'ask',
      'input',
      { text: 'Name the new colony:', value: 'Jamestown', ok: 'OK', cancel: 'Cancel', tile: null },
    ],
  },
};
