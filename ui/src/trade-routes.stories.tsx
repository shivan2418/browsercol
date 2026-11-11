// The trade routes panel as the game shows it, with the game's own art: a route of four stops to edit and
// reorder by dragging. Saving and closing do nothing.
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { dialogs } from './dialogs';
import { DialogHost } from './panels';
import { art } from './story-art';
import type { GuiEvents } from './webgui';

type Routes = GuiEvents['tradeRoutes'];

const none = new Proxy({}, { get: () => () => {} }) as never;

const goods = (id: string, name: string) => ({ id: `model.goods.${id}`, name, icon: `image.icon.model.goods.${id}` });

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
  ],
  places: [
    { id: 'europe:1', label: 'Europe' },
    { id: 'colony:7', label: 'New Amsterdam' },
    { id: 'colony:8', label: 'Jamestown' },
    { id: 'colony:9', label: 'Plymouth' },
  ],
  goods: [goods('tools', 'Tools'), goods('furs', 'Furs'), goods('sugar', 'Sugar'), goods('food', 'Food')],
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
