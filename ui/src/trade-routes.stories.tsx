// The trade routes panel as the game shows it, with the game's own art: a route of four stops to edit and
// reorder by dragging, and one from an inland colony to Europe that no carrier can follow. Saving and closing do nothing.
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { dialogs } from './dialogs';
import { DialogHost } from './panels';
import { art } from './story-art';
import type { GuiEvents } from './webgui';

type Routes = GuiEvents['tradeRoutes'];

const none = new Proxy({}, { get: () => () => {} }) as never;

const goods = (id: string, name: string) => ({ id: `model.goods.${id}`, name, icon: `image.icon.model.goods.${id}` });

/** A colony's warehouse as the Engine reports it: goods by type, with what it has and keeps, and its room. */
const warehouse = (capacity: number, goods: Record<string, [have: number, keep: number]>) =>
  Object.fromEntries(
    Object.entries(goods).map(([g, [have, keep]]) => [
      `model.goods.${g}`,
      { have, keep, give: Math.max(0, have - keep), upTo: capacity, room: Math.max(0, capacity - have) },
    ]),
  );

const panel: Routes = {
  title: 'Trade Routes',
  unit: null,
  assign: 'Assign Trade Route',
  unassign: 'Drop Trade Route',
  tooltips: {
    new: 'Create a new trade route.',
    edit: 'Edit an existing trade route.',
    delete: 'Delete this trade route completely.',
    deassign: 'Do not follow this trade route anymore.',
  },
  routes: [
    {
      id: 'tradeRoute:1',
      name: 'Fur run',
      silent: false,
      units: 1,
      stops: [
        { place: 'europe:1', label: 'Europe', cargo: ['model.goods.tools', 'model.goods.tools'] },
        { place: 'colony:7', label: 'New Amsterdam', cargo: ['model.goods.furs', 'model.goods.furs'] },
        { place: 'colony:8', label: 'Jamestown', cargo: ['model.goods.furs', 'model.goods.sugar'] },
        { place: 'colony:9', label: 'Plymouth', cargo: [] },
      ],
    },
    {
      id: 'tradeRoute:2',
      name: 'Inland furs',
      silent: false,
      units: 0,
      stops: [
        { place: 'colony:10', label: 'Fort Orange', cargo: ['model.goods.furs'] },
        { place: 'europe:1', label: 'Europe', cargo: ['model.goods.tools'] },
      ],
    },
  ],
  places: [
    { id: 'europe:1', label: 'Europe', port: true, land: null, stock: null },
    {
      id: 'colony:7',
      label: 'New Amsterdam',
      port: true,
      land: 1,
      stock: warehouse(200, { furs: [230, 50], tools: [140, 0], sugar: [0, 50], food: [80, 50] }),
    },
    {
      id: 'colony:8',
      label: 'Jamestown',
      port: true,
      land: 1,
      stock: warehouse(100, { furs: [20, 50], tools: [60, 50], sugar: [170, 50], food: [40, 50] }),
    },
    {
      id: 'colony:9',
      label: 'Plymouth',
      port: true,
      land: 1,
      stock: warehouse(100, { furs: [40, 50], tools: [0, 50], sugar: [15, 50], food: [90, 50] }),
    },
    { id: 'colony:10', label: 'Fort Orange', port: false, land: 1, stock: null },
  ],
  goods: [goods('tools', 'Tools'), goods('furs', 'Furs'), goods('sugar', 'Sugar'), goods('food', 'Food')],
  enhanced: false,
  overflow: 'ask',
  projected: false,
  error: null,
  newRoute: 'New Trade Route',
  defaultName: 'Trade route 2',
  editRoute: 'Edit Trade Route',
  deleteRoute: 'Delete Trade Route',
  nameLabel: 'Name',
  destinationLabel: 'Destination',
  silence: 'Silence messages',
  addStop: 'Add new stop',
  removeStop: 'Remove stop',
  allColonies: 'All colonies',
  ok: 'OK',
  cancel: 'Cancel',
};

/** The panel, shown through the same DialogHost the page uses; Edit Trade Route opens the editor. */
function TradeRoutes({ routes }: { routes: Routes }) {
  const box = useMemo(() => {
    const b = dialogs();
    b.replace('tradeRoutes', routes);
    return b;
  }, [routes]);
  return <DialogHost dialogs={box} goTo={() => {}} art={art} report={none} routes={none} />;
}

const meta: Meta<typeof TradeRoutes> = { component: TradeRoutes, args: { routes: panel } };
export default meta;

export const Default: StoryObj<typeof TradeRoutes> = {};

/** With the enhanced trade routes option: holds show in the order they load, and do not drag. */
export const Enhanced: StoryObj<typeof TradeRoutes> = { args: { routes: { ...panel, enhanced: true } } };
