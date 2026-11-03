// The Europe screen as the game shows it, with the game's own art; the buttons do nothing.
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { dialogs } from './dialogs';
import { europe } from './europe-fixture';
import { DialogHost } from './panels';
import { art } from './story-art';
import type { GuiEvents } from './webgui';

const none = new Proxy({}, { get: () => () => {} }) as never;

/** The panel, shown through the same DialogHost the page uses. */
function Europe({ event }: { event: GuiEvents['europe'] }) {
  const box = useMemo(() => {
    const b = dialogs();
    b.show('europe', event);
    return b;
  }, [event]);
  return <DialogHost dialogs={box} goTo={() => {}} art={art} report={none} routes={none} />;
}

const meta: Meta<typeof Europe> = { component: Europe, args: { event: europe } };
export default meta;

export const Default: StoryObj<typeof Europe> = {};

export const NoShipInPort: StoryObj<typeof Europe> = {
  args: { event: { ...europe, inPort: [], selected: '' } },
};
