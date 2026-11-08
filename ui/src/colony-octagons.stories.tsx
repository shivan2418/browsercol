// The colony panel's population octagons on their own (#376): FreeCol's painted octagons with every kind of
// number the panel writes in them, for comparing how the numbers are set. `treatment` picks a font treatment
// (story-only CSS over the game's .octagon styles; "now" is the game's look), `theme` the palette and `scale` the
// display scaling, as --ui-zoom zooms a window.
import { useLayoutEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Octagon, type OctagonPart } from './colony-panel';
import { art } from './story-art';

const TREATMENTS = {
  now: 'The game today: Cinzel bold in dark ink, 32px; the shares 18px under the muskets and crown.',
  cinzel: 'Cinzel bold in dark ink, cut into the wood; sized to fit, the % sign small.',
  ink: 'Noto Sans bold in dark ink, cut into the wood, tabular figures; sized to fit, the % sign small.',
  outline: 'Noto Sans bold in white with a black outline, as the numbers over a pile of goods; a loss in red.',
  shadow: 'Noto Sans bold in the title bars’ cream, on a soft dark shadow rather than an outline.',
} as const;
type Treatment = keyof typeof TREATMENTS;

/** Under .octagon-sheet[data-treatment]: each treatment's rules, over the game's own (index.html .colony .octagon). */
const CSS = `
.octagon-sheet { width: max-content; padding: 12px; background: var(--panel); color: var(--ink); font: var(--fs-s) / 1.4 var(--font); }
.octagon-sheet h3 { margin: 10px 0 4px; font: 700 var(--fs) var(--font-title); color: var(--head); }
.octagon-sheet h3:first-child { margin-top: 0; }
.octagon-sheet .note { margin: 0 0 8px; color: var(--muted); max-width: 640px; }
.octagon-sheet .row { display: flex; flex-wrap: wrap; gap: 4px; }
.octagon-sheet .cell { position: relative; width: 72px; height: 70px; }
.octagon-sheet .colony .cell .octagon { top: 2px; left: 2px; right: auto; }

/* Engraved: dark ink with a light edge under each stroke. */
[data-treatment='cinzel'] .colony .cell .octagon,
[data-treatment='ink'] .colony .cell .octagon {
  color: var(--paper-ink);
  text-shadow: 0 1px 0 color-mix(in srgb, var(--menubar-ink) 55%, transparent);
}
[data-treatment='ink'] .colony .cell .octagon,
[data-treatment='outline'] .colony .cell .octagon,
[data-treatment='shadow'] .colony .cell .octagon {
  font-family: var(--font);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
[data-treatment='outline'] .colony .cell .octagon {
  color: var(--pile-ink);
  text-shadow:
    -1px -1px 0 var(--pile-outline), 1px -1px 0 var(--pile-outline),
    -1px 1px 0 var(--pile-outline), 1px 1px 0 var(--pile-outline),
    0 2px 3px color-mix(in srgb, var(--pile-outline) 50%, transparent);
}
[data-treatment='outline'] .colony .cell[data-sign='loss'] .octagon { color: var(--pile-loss); }
[data-treatment='shadow'] .colony .cell .octagon {
  color: var(--menubar-ink);
  text-shadow: 0 1px 1px color-mix(in srgb, var(--pile-outline) 90%, transparent), 0 0 4px color-mix(in srgb, var(--pile-outline) 75%, transparent);
}

/* Sizes: the number in the middle of the face, smaller as it gets longer; the shares low, under the art. */
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon { line-height: 1; padding-top: 3px; }
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon.size { font-size: 30px; }
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon.change { font-size: 26px; }
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon[data-len='3'] { font-size: 23px; }
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon:is(.rebels, .royalists) {
  align-items: flex-end;
  padding: 0 0 12px;
  font-size: 17px;
}
.octagon-sheet:not([data-treatment='now']) .colony .cell .octagon[data-len='4'] { font-size: 15px; }
.octagon-sheet:not([data-treatment='now']) .octagon .pc { font-size: 0.68em; margin-left: 1px; }
.octagon-sheet[data-treatment='cinzel'] .colony .cell .octagon:is(.size, .change)[data-len='3'] { font-size: 20px; }
`;

const SIZES = ['1', '2', '4', '7', '9', '10', '11', '14', '19', '20', '38', '88', '99', '100'];
/** As ColonyJson writes them: a sign on a gain or none, ">9" for more than 9. */
const CHANGES = ['+0', '+1', '-1', '+4', '-7', '+9', '>9', '-12'];
const SHARES = ['0', '1', '7', '11', '33', '49', '50', '99', '100'].map((n) => `${n}%`);

interface Args {
  treatment: Treatment;
  theme: 'parchment' | 'dark';
  scale: 1 | 1.5 | 2;
}

function Sheet({ treatment, theme, scale }: Args) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
  }, [theme]);
  // A real minus for a loss, in our treatments; the game writes a hyphen today.
  const text = (t: string) => (treatment === 'now' ? t : t.replace('-', '−'));
  const row = (part: OctagonPart, values: string[]) => (
    <div className="row">
      {values.map((v) => (
        <span key={v} className="cell" data-sign={v.startsWith('-') ? 'loss' : undefined}>
          <Octagon part={part} text={text(v)} art={art} />
        </span>
      ))}
    </div>
  );
  return (
    <>
      <style>{CSS}</style>
      <div className="octagon-sheet" data-treatment={treatment} style={{ zoom: scale }}>
        <p className="note">
          <b>{treatment}</b> · {theme} · {scale * 100}% — {TREATMENTS[treatment]}
        </p>
        <div className="colony">
          <h3>Size</h3>
          {row('size', SIZES)}
          <h3>Change</h3>
          {row('change', CHANGES)}
          <h3>Rebels</h3>
          {row('rebels', SHARES)}
          <h3>Royalists</h3>
          {row('royalists', SHARES)}
        </div>
      </div>
    </>
  );
}

const meta: Meta<typeof Sheet> = {
  title: 'Colony octagons',
  component: Sheet,
  args: { treatment: 'now', theme: 'parchment', scale: 1 },
  argTypes: {
    treatment: { control: 'select', options: Object.keys(TREATMENTS) },
    theme: { control: 'inline-radio', options: ['parchment', 'dark'] },
    scale: { control: 'inline-radio', options: [1, 1.5, 2] },
  },
};
export default meta;

export const Numbers: StoryObj<typeof Sheet> = {};
