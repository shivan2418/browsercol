// The side panel beside the map: the turn, the command buttons, the info
// panel (FreeCol's InfoPanel, as text), the dialogs the Browser UI cannot
// show yet, and the page's status. main.tsx renders it again on each change.
import type { Command } from './input';

export interface SideProps {
  turn: string;
  /** The info panel's lines. */
  info: string;
  /** WebGUI dialogs with no Browser UI yet, by method, each time one was asked. */
  unasked: string[];
  /** The page's status, as window.fcResult shows it. */
  status: string;
  /** The orders the active unit can take now, by name, as the Engine says. */
  orders: string[];
  run: (c: Command) => void;
}

/** The buttons, as the keys they stand for. */
const BUTTONS: [string, Command][] = [
  ['Next unit (W)', { k: 'nextUnit' }],
  ['Build colony (B)', { k: 'buildColony' }],
  ['End turn (Enter)', { k: 'endTurn' }],
];

/**
 * The standing orders, with the keys the Swing client binds them to: the
 * order's name, as the Engine sends it, and the command it stands for.
 */
const ORDERS: [string, string, Command][] = [
  ['Fortify (F)', 'fortify', { k: 'fortify' }],
  ['Sentry (S)', 'sentry', { k: 'sentry' }],
  ['Skip (Space)', 'skip', { k: 'skip' }],
  ['Disband (D)', 'disband', { k: 'disband' }],
  ['Plow (P)', 'plow', { k: 'plow' }],
  ['Clear forest (C)', 'clearForest', { k: 'clearForest' }],
  ['Road (R)', 'road', { k: 'road' }],
  ['Go to (H)', 'goto', { k: 'selectDestination' }],
];

/** How many times each item is in a list, in first-seen order. */
function counts(list: string[]): [string, number][] {
  const n = new Map<string, number>();
  for (const s of list) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n];
}

export function Side({ turn, info, unasked, status, orders, run }: SideProps) {
  return (
    <>
      <div>
        Turn: <span id="turn">{turn}</span>
      </div>
      <div>
        {BUTTONS.map(([label, c]) => (
          <button key={c.k} data-command={c.k} onClick={() => run(c)}>
            {label}
          </button>
        ))}
      </div>
      <div>
        {ORDERS.map(([label, name, c]) => (
          <button key={c.k} data-command={c.k} disabled={!orders.includes(name)} onClick={() => run(c)}>
            {label}
          </button>
        ))}
      </div>
      <div>
        Click a unit to select it, click a tile to go there. Arrows or numpad move. Drag, or rest the pointer at an
        edge, to scroll; the wheel zooms.
      </div>
      <div id="info">{info}</div>
      {unasked.length > 0 && (
        <div id="unasked">
          Not asked yet (FreeCol's default was used):
          <ul>
            {counts(unasked).map(([method, n]) => (
              <li key={method}>
                {method}
                {n > 1 ? ` x${n}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div id="out">{status}</div>
    </>
  );
}
