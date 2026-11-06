// The game's buttons with FreeCol's bevel (#268, FreeColButtonUI), in each state and in both palettes.
import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WindowFrame } from './frame';
import { PALETTES, applyTheme } from './theme';

/** The palettes set their tokens on the root, so a story switches the page's palette while it shows. */
function Palette({ id, children }: { id: (typeof PALETTES)[number]['id']; children: ReactNode }) {
  useEffect(() => {
    applyTheme(document.documentElement, id, 'cinzel-noto');
    return () => applyTheme(document.documentElement, 'parchment', 'cinzel-noto');
  }, [id]);
  return <>{children}</>;
}

/** The states a pointer puts a button in; data-state shows hover and pressed without one. Default is the button Enter presses (data-enter). */
const states = (
  <>
    <p>Hover and press any of them to see the real thing.</p>
    <div className="buttons" style={{ justifyContent: 'flex-start' }}>
      <button type="button">Normal</button>
      <button type="button" data-state="hover">
        Hover
      </button>
      <button type="button" data-state="pressed">
        Pressed
      </button>
      <button type="button" disabled>
        Disabled
      </button>
      <button type="button" aria-pressed="true">
        Picked
      </button>
      <button type="button" data-enter>
        Default
      </button>
    </div>
    <div className="buttons" style={{ justifyContent: 'flex-start' }}>
      <button type="button">A longer button label</button>
      <button type="button" style={{ padding: '2px 6px' }}>
        +
      </button>
    </div>
  </>
);

const meta: Meta = {
  title: 'Buttons',
  decorators: [
    (Story, { args }) => (
      <Palette id={args.palette}>
        <WindowFrame className="dialog" aria-modal="true" title="Buttons" close={() => {}}>
          <Story />
        </WindowFrame>
      </Palette>
    ),
  ],
  render: () => states,
};
export default meta;

export const Parchment: StoryObj = { args: { palette: 'parchment' } };
export const Dark: StoryObj = { args: { palette: 'dark' } };
