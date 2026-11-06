// Every native form control as the game draws them (#258, docs/adr/0006), in each state and in both palettes.
import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { controlArt } from './control-art';
import { WindowFrame } from './frame';
import { PALETTES, applyTheme } from './theme';
import { art } from './story-art';

/** The palettes set their tokens on the root, so a story switches the page's palette while it shows. */
function Palette({ id, children }: { id: (typeof PALETTES)[number]['id']; children: ReactNode }) {
  useEffect(() => {
    controlArt(document.documentElement, art);
    applyTheme(document.documentElement, id, 'cinzel-noto');
    return () => applyTheme(document.documentElement, 'parchment', 'cinzel-noto');
  }, [id]);
  return <>{children}</>;
}

const states = (
  <>
    <label>
      <input type="checkbox" /> Off
    </label>
    <br />
    <label>
      <input type="checkbox" defaultChecked /> On
    </label>
    <br />
    <label>
      <input type="checkbox" disabled /> Disabled off
    </label>
    <br />
    <label>
      <input type="checkbox" disabled defaultChecked /> Disabled on
    </label>
    <br />
    <label>
      <input type="checkbox" autoFocus defaultChecked /> Focused (use Tab to see the ring)
    </label>
    <hr />
    <label>
      <input type="radio" name="r" /> Off
    </label>
    <br />
    <label>
      <input type="radio" name="r" defaultChecked /> On
    </label>
    <br />
    <label>
      <input type="radio" name="d" disabled /> Disabled off
    </label>
    <br />
    <label>
      <input type="radio" name="d" disabled defaultChecked /> Disabled on
    </label>
    <hr />
    <div className="options">
      <span className="slider">
        <input type="range" defaultValue={40} aria-label="Slider" />
        <input type="range" defaultValue={70} disabled aria-label="Disabled slider" />
      </span>
    </div>
    <p>
      <progress value={35} max={100} /> <progress value={100} max={100} />
    </p>
    <details open>
      <summary>An open disclosure</summary>
      <p>Its contents.</p>
    </details>
    <details>
      <summary>A closed disclosure</summary>
      <p>Its contents.</p>
    </details>
    <p>
      <input type="text" defaultValue="Selected text, and a caret" />
    </p>
  </>
);

const meta: Meta = {
  title: 'Form controls',
  decorators: [
    (Story, { args }) => (
      <Palette id={args.palette}>
        <WindowFrame className="dialog" aria-modal="true" title="Form controls" close={() => {}}>
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
