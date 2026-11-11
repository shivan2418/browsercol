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
          {/* As Panel (panels.tsx) adds them below the colony. */}
          <div className="buttons">
            <button>Warehouse</button>
            <button>OK</button>
          </div>
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

const lockedQueue = {
  ...jamestown.queue,
  buildings: [
    ...jamestown.queue.buildings,
    ...['Iron works', 'Cigar factory', 'Textile mill', 'University'].map((name, i) => ({
      ...jamestown.queue.buildings[1],
      type: `model.building.locked${i}`,
      name,
      required:
        i % 2
          ? jamestown.queue.buildings[0].required
          : [...jamestown.queue.buildings[0].required, ...jamestown.queue.buildings[0].required],
      reason: i % 2 ? 'Requires: Adam Smith' : "Requires: Adam Smith/Blacksmith's shop",
    })),
  ],
  units: [
    ...jamestown.queue.units,
    ...['Merchantman', 'Privateer', 'Man of War'].map((name, i) => ({
      ...jamestown.queue.units[0],
      type: `model.unit.locked${i}`,
      name,
      reason: i === 2 ? 'Requires: Declare independence/Shipyard' : 'Requires: Shipyard',
    })),
  ],
};

/** The build queue open with "Show all" ticked: rows that cannot be built yet keep name, costs and requirement apart. */
export const BuildQueueLocked: StoryObj<typeof ColonyPanel> = {
  args: { colony: { ...jamestown, buildings, queue: lockedQueue } },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.building[data-builds]')?.click();
    await new Promise((ok) => setTimeout(ok, 100));
    canvasElement.querySelector<HTMLInputElement>('.show-all input')?.click();
  },
};
