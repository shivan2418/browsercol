// The Open Game window with Export save... on each save (#368), and with what became of an export.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { OpenDialog } from './save-picker';

const saves = [
  { id: 3, name: 'Autosave', date: Date.UTC(2026, 10, 7, 20, 15), turn: 41, year: 1545, nation: 'Dutch', size: 91234 },
  {
    id: 2,
    name: 'Before the war',
    date: Date.UTC(2026, 10, 6, 9, 2),
    turn: 28,
    year: 1530,
    nation: 'Dutch',
    size: 70311,
  },
  {
    id: 1,
    name: 'Dutch, turn 5 (1496)',
    date: Date.UTC(2026, 10, 5, 18, 40),
    turn: 5,
    year: 1496,
    nation: 'Dutch',
    size: 40021,
  },
];

const meta = {
  title: 'Dialogs/Open Game',
  component: OpenDialog,
  args: { saves, open: () => {}, exportSave: () => {}, openFile: () => {}, close: () => {} },
} satisfies Meta<typeof OpenDialog>;
export default meta;

export const WithExport: StoryObj<typeof meta> = {};
export const Exported: StoryObj<typeof meta> = { args: { note: 'Exported: Before the war' } };
