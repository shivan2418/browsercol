// Throwaway prototype (#390): hover and drag feedback for the things in the game world, today's wash against three
// game-like treatments, side by side in one sheet. The states are forced with classes (.hv for the hover, .ov for a
// drop target the dragged thing is over) so a screenshot shows them; the real :hover rules are switched off in the
// treatments, which use the colour tokens only. Not wired into the game.
//   today  the washes the game has now.
//   A      FreeCol's own: nothing on hover, the pointer alone; a drag shows only the dragged picture, no target marked.
//   B      the picture itself brightens and glows; no box.
//   C      a thin square rim in the ink; no rounded corners.
import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { art } from './story-art';

const T = ['today', 'A', 'B', 'C'] as const;
type Treatment = (typeof T)[number];
const HEAD: Record<Treatment, string> = {
  today: 'Today: accent or box wash, rounded; the drop place gets a 14% accent tint',
  A: 'A, as FreeCol: nothing on hover, the pointer only; a drag shows only the dragged picture',
  B: 'B: the picture brightens and glows; no box',
  C: 'C: a thin square rim in the ink (2px on a drop place)',
};

const CSS = `
.hd-sheet { padding: 12px; background: var(--panel); color: var(--ink); font: var(--fs-s) / 1.4 var(--font); width: max-content; }
.hd-sheet h2 { margin: 0 0 6px; font: 700 var(--fs-h) var(--font-title); color: var(--head); }
.hd-grid { display: grid; grid-template-columns: 110px repeat(4, 330px); gap: 10px; align-items: start; }
.hd-grid .rowlabel { font-weight: 700; color: var(--head); padding-top: 4px; }
.hd-grid .colhead { font-weight: 700; border-bottom: 2px solid var(--line); padding-bottom: 2px; }
.hd-cell { position: relative; min-height: 40px; }
.hd-cell .note { margin: 4px 0 0; font-size: 11px; color: var(--muted); }
.hd-cell .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.hd-sheet img.g { width: 32px; height: 32px; object-fit: contain; display: block; }
.hd-sheet .colony .building { position: relative; transform: none; left: auto; top: auto; flex: none; }
.hd-sheet .colony .construction { width: 100%; min-height: 60px; }
.hd-sheet .colony .buildable { width: 60px; height: 56px; }
.hd-sheet .europe .chips, .hd-sheet .europe-body .goods { display: flex; flex-wrap: wrap; gap: 8px; }
.hd-sheet .europe-body .good { display: flex; gap: 4px; }
.hd-sheet .europe-body { flex: none; display: block; }
.hd-sheet .drop { box-sizing: border-box; width: 150px; min-height: 64px; padding: 4px; border: 1px solid var(--line); background: var(--box); }
.hd-sheet .drop b { display: block; font-size: 11px; color: var(--muted); }
.hd-sheet .ghost { position: absolute; left: 118px; top: 44px; opacity: 0.85; pointer-events: none; }

/* The real :hover rules off, in every treatment but today (the forced classes below stand in). */
.hd-sheet [data-t]:not([data-t='today']) :is(.construction[role='button'], .building[data-builds], button.good, .chip, button.chip):hover { background: none; border-radius: 0; }
.hd-sheet [data-t]:not([data-t='today']) .hold:not(.empty):hover::after { content: none; }

/* today */
[data-t='today'] .colony :is(.building[data-builds], .construction[role='button']).hv { background: color-mix(in srgb, var(--accent) 15%, transparent); }
[data-t='today'] :is(button.good, button.chip).hv { background: var(--box); border-radius: 4px; }
[data-t='today'] .hold.hv::after { content: '✕'; position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--bad) 60%, transparent); color: var(--box); font-weight: bold; }
[data-t='today'] .drop.ov { background: color-mix(in srgb, var(--accent) 14%, var(--box)); }

/* A: nothing. The pointer, as FreeCol's: a hand where a click acts. */
[data-t='A'] :is(.building[data-builds], .construction[role='button'], button.good, button.chip, .hold) { cursor: pointer; }

/* B: the sprite itself. */
[data-t='B'] .hv img, [data-t='B'] .drop.ov img { filter: brightness(1.25) drop-shadow(0 0 3px var(--accent)); }
[data-t='B'] .drop.ov { filter: brightness(1.12); }

/* C: a square rim. */
[data-t='C'] :is(.building[data-builds], .construction[role='button'], button.good, button.chip, .hold).hv { outline: 1px solid var(--ink); outline-offset: -1px; border-radius: 0; }
[data-t='C'] .drop.ov { outline: 2px solid var(--ink); outline-offset: -2px; }
`;

const pic = (key: string) => <img className="g" src={art([`image.${key}`]) ?? undefined} alt="" />;
const goods = (n: string) => pic(`icon.model.goods.${n}`);
const home = (n: string) => art([`image.buildingicon.model.building.${n}`]) ?? undefined;

function Cell({ t, children, note }: { t: Treatment; children: ReactNode; note?: string }) {
  return (
    <div className="hd-cell" data-t={t}>
      {children}
      {note && <p className="note">{note}</p>}
    </div>
  );
}

function Sheet({ theme }: { theme: 'parchment' | 'dark' }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
  }, [theme]);
  const building = (hv: boolean, builds: boolean) => (
    <div
      className={`building${hv ? ' hv' : ''}`}
      data-builds={builds || undefined}
      style={{ width: 130, height: 90, background: 'var(--box)' }}
    >
      <span className="name">{builds ? 'Carpenter’s house' : 'Town Hall'}</span>
      <img className="art" src={home(builds ? 'carpenterHouse' : 'townHall')} alt="" />
    </div>
  );
  const chip = (g: string, hv: boolean, n: string) => (
    <button className={`chip${hv ? ' hv' : ''}`} data-drag="">
      {goods(g)}
      <span className="name">{n}</span>
    </button>
  );
  const rows = (label: string, cell: (t: Treatment) => ReactNode) => (
    <>
      <div className="rowlabel">{label}</div>
      {T.map((t) => (
        <div key={t}>{cell(t)}</div>
      ))}
    </>
  );
  return (
    <>
      <style>{CSS}</style>
      <div className="hd-sheet">
        <h2>#390 hover and drag feedback · {theme}</h2>
        <div className="hd-grid">
          <span />
          {T.map((t) => (
            <div key={t} className="colhead">
              {HEAD[t]}
            </div>
          ))}

          {rows('Cargo drag (priority)', (t) => (
            <Cell
              t={t}
              note="Left: a place that takes the goods, the drag over it. Right: one that refuses, nothing marked, the pointer no-drop. The floating picture is the dragged goods."
            >
              <div className="row">
                <div className="drop ov">
                  <b>Warehouse</b>
                  <div className="row">
                    {goods('sugar')}
                    {goods('furs')}
                  </div>
                </div>
                <div className="drop" style={{ cursor: 'no-drop' }}>
                  <b>Building (refuses goods)</b>
                  <div className="row">{goods('tobacco')}</div>
                </div>
                <div className="ghost">{goods('rum')}</div>
              </div>
            </Cell>
          ))}
          {rows('Europe goods and chips', (t) => (
            <Cell t={t} note="Second good and second chip hovered.">
              <div className="europe europe-body">
                <div className="goods">
                  <button className="good">
                    {goods('sugar')}
                    <span className="price">5/7</span>
                  </button>
                  <button className="good hv">
                    {goods('tobacco')}
                    <span className="price">4/6</span>
                  </button>
                </div>
                <div className="chips" style={{ marginTop: 6 }}>
                  {chip('furs', false, '40')}
                  {chip('rum', true, '100')}
                </div>
              </div>
            </Cell>
          ))}
          {rows('Colony buildings', (t) => (
            <Cell t={t} note="Carpenter’s house hovered (it opens the queue); the Town Hall does nothing.">
              <div className="colony row">
                {building(false, false)}
                {building(true, true)}
              </div>
            </Cell>
          ))}
          {rows('Build-queue entry', (t) => (
            <Cell t={t} note="Hovered.">
              <div className="colony">
                <div className="box construction hv" role="button" style={{ background: 'var(--box)' }}>
                  <img className="buildable" src={home('carpenterHouse')} alt="" />
                  <span>Carpenter’s house</span>
                </div>
              </div>
            </Cell>
          ))}
          {rows('Ship hold', (t) => (
            <Cell t={t} note="Second hold hovered (a click empties it).">
              <div className="dialog">
                <div className="holds">
                  <button className="hold">{goods('sugar')}</button>
                  <button className="hold hv">{goods('furs')}</button>
                  <button className="hold empty">+</button>
                </div>
              </div>
            </Cell>
          ))}
        </div>
        <p style={{ maxWidth: 900 }}>
          Hover is forced with a class, not the pointer. FreeCol&rsquo;s Swing client (DefaultTransferHandler,
          DragListener, DropListener) makes the dragged image the cursor and does nothing on drag-over or hover, so A
          matches it.
        </p>
      </div>
    </>
  );
}

const meta: Meta<typeof Sheet> = {
  title: 'Prototype/Hover and drag look (390)',
  component: Sheet,
  args: { theme: 'parchment' },
  argTypes: { theme: { control: 'inline-radio', options: ['parchment', 'dark'] } },
};
export default meta;
export const Sheets: StoryObj<typeof Sheet> = {};
