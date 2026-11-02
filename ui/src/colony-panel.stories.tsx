// The colony panel on its own, with the test fixture and stand-in art, for looking at its layout.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColonyActions, ColonyPanel, type ColonyMoves } from './colony-panel';
import { jamestown } from './colony-fixture';
import { WindowFrame } from './frame';
import { art } from './story-art';

const noop = new Proxy({}, { get: () => () => {} }) as ColonyMoves;
const ship = { id: 'unit:9', name: 'Caravel', keys: ['image.unit.model.unit.caravel'] };
const buildings = Array.from({ length: 14 }, (_, i) => ({
  ...jamestown.buildings[i % 2],
  id: `building:${i}`,
  type: `model.building.b${i}`,
  name: `Building ${i}`,
}));

const meta: Meta<typeof ColonyPanel> = {
  component: ColonyPanel,
  args: { colony: { ...jamestown, buildings }, art },
  decorators: [
    (Story) => (
      <ColonyActions.Provider value={noop}>
        <WindowFrame className="dialog" aria-modal="true" data-kind="colony" title="Jamestown" close={() => {}}>
          <Story />
        </WindowFrame>
      </ColonyActions.Provider>
    ),
  ],
};
export default meta;

export const Default: StoryObj<typeof ColonyPanel> = {};

export const ShipInPort: StoryObj<typeof ColonyPanel> = {
  args: {
    colony: {
      ...jamestown,
      buildings,
      inPort: {
        title: 'In Port',
        units: [{ ...ship, cargo: { title: 'Cargo', units: [], goods: [] } }],
        selected: ship.id,
        cargo: 'Cargo',
      },
    },
  },
};
