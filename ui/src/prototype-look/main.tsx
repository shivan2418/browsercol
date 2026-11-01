// PROTOTYPE (#48), throwaway: three looks for the Browser UI's panels and
// dialogs, on mock content, switchable from a floating bar.
//   ?variant=A|B|C            the look
//   ?show=none|choice|glance|colony|europe   what is open over the map (glance: D's colony drawer)
//   ?theme=light|dark         (default: the variant's own)
// Arrow keys cycle the variant; 1-4 pick what is open; T flips the theme.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VariantA } from './variant-a';
import { VariantB } from './variant-b';
import { VariantC } from './variant-c';
import { VariantD } from './variant-d';
import { VariantE } from './variant-e';

export type Show = 'none' | 'choice' | 'glance' | 'colony' | 'europe';
export type Theme = 'light' | 'dark';
export interface VariantProps {
  show: Show;
  theme: Theme;
  open: (s: Show) => void;
}

const VARIANTS = [
  { key: 'A', name: 'Ledger: light windows, tables', theme: 'light', C: VariantA },
  { key: 'B', name: 'Field kit: dark docked drawer, chips', theme: 'dark', C: VariantB },
  { key: 'C', name: 'Big board: full-screen sheets, big type', theme: 'dark', C: VariantC },
  { key: 'D', name: 'Big board + colony drawer', theme: 'dark', C: VariantD },
  { key: 'E', name: 'FreeCol layout, colours to tune', theme: 'light', C: VariantE },
] as const;
const SHOWS: Show[] = ['none', 'choice', 'glance', 'colony', 'europe'];

function read() {
  const p = new URLSearchParams(location.search);
  const i = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === p.get('variant')),
  );
  const show = (SHOWS.includes(p.get('show') as Show) ? p.get('show') : 'colony') as Show;
  const theme = (p.get('theme') ?? VARIANTS[i].theme) as Theme;
  return { i, show, theme, themeSet: p.has('theme') };
}

function App() {
  const [s, setS] = useState(read);
  const go = (next: Partial<typeof s>) => {
    const n = { ...s, ...next };
    if (next.i !== undefined && !next.themeSet && !s.themeSet) n.theme = VARIANTS[n.i].theme;
    const p = new URLSearchParams({ variant: VARIANTS[n.i].key, show: n.show });
    if (n.themeSet) p.set('theme', n.theme);
    history.replaceState(null, '', `?${p}`);
    setS(n);
  };
  const cycle = (d: number) => go({ i: (s.i + d + VARIANTS.length) % VARIANTS.length });
  const flip = () => go({ theme: s.theme === 'light' ? 'dark' : 'light', themeSet: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      else if (e.key === 'ArrowRight') cycle(1);
      else if (e.key >= '1' && e.key <= '5' && !e.altKey) go({ show: SHOWS[Number(e.key) - 1] });
      else if (e.key === 't') flip();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const V = VARIANTS[s.i];
  return (
    <>
      <V.C show={s.show} theme={s.theme} open={(show) => go({ show })} />
      {(
        <div className="proto-bar">
          <button onClick={() => cycle(-1)} title="Previous look (←)">
            ◀
          </button>
          <span className="proto-label">
            <b>{V.key}</b> {V.name}
          </span>
          <button onClick={() => cycle(1)} title="Next look (→)">
            ▶
          </button>
          <span className="proto-sep" />
          {SHOWS.map((sh, n) => (
            <button key={sh} className={sh === s.show ? 'on' : ''} onClick={() => go({ show: sh })} title={`${n + 1}`}>
              {sh === 'none' ? 'Map' : sh === 'glance' ? 'Drawer' : sh[0].toUpperCase() + sh.slice(1)}
            </button>
          ))}
          <span className="proto-sep" />
          <button onClick={flip} title="Light / dark (T)">
            {s.theme === 'light' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
