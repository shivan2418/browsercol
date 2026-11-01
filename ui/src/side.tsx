// The side panel beside the map, a debug scaffold (docs/adr/0004): the
// turn, the command buttons, the info
// panel (FreeCol's InfoPanel, as text), the dialogs the Browser UI cannot
// show yet, the saved games and the page's status. main.tsx renders it again on each change.
import { useRef } from 'react';
import { DebugMenu, type DebugMenuProps } from './debug-menu';
import type { Command } from './input';
import type { SaveMeta } from './saves';

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
  /** The saved games, newest first. */
  saves: SaveMeta[];
  /** What happened to the last save, load or delete; empty for nothing yet. */
  saveNote: string;
  run: (c: Command) => void;
  /** Save the game under a name; empty for the default one. */
  save: (name: string) => void;
  /** Load a saved game in place of this one. */
  load: (id: number) => void;
  remove: (id: number) => void;
  /** Download a saved game as its .fsg file. */
  exportSave: (id: number) => void;
  /** Add a .fsg file the player chose to the saved games. */
  importFile: (file: File) => void;
  /** The debug menu, in debug mode (`?debug`) only: with none, it is not drawn. */
  debug?: DebugMenuProps;
}

/** The buttons, as the keys they stand for. */
const BUTTONS: [string, Command][] = [
  ['Next unit (W)', { k: 'nextUnit' }],
  ['Build colony (B)', { k: 'buildColony' }],
  ['End turn (Enter)', { k: 'endTurn' }],
  ['Declare independence', { k: 'declareIndependence' }],
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

/** A save's line in the list: its name, when it was made, the turn and the nation. */
const saveLine = (s: SaveMeta) =>
  `${s.name} | ${new Date(s.date).toLocaleString()} | turn ${s.turn} (${s.year}) | ${s.nation}`;

export function Side({
  turn,
  info,
  unasked,
  status,
  orders,
  saves,
  saveNote,
  run,
  save,
  load,
  remove,
  exportSave,
  importFile,
  debug,
}: SideProps) {
  const name = useRef<HTMLInputElement>(null);
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
      {debug && <DebugMenu {...debug} />}
      <div id="saving">
        <input ref={name} id="save-name" placeholder="Save name (optional)" />
        <button
          data-command="save"
          onClick={() => {
            save(name.current?.value ?? '');
            if (name.current) name.current.value = '';
          }}
        >
          Save game
        </button>
        <span id="save-note">{saveNote}</span>
        <div>
          <label>
            Import a .fsg:{' '}
            <input
              id="import-file"
              type="file"
              accept=".fsg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile(file);
                e.target.value = ''; // so the same file can be chosen again
              }}
            />
          </label>
        </div>
        <div id="saves">
          {saves.length === 0 && 'No saved games'}
          {saves.map((s) => (
            <div key={s.id} data-save={s.id}>
              {saveLine(s)}{' '}
              <button data-load={s.id} onClick={() => load(s.id)}>
                Load
              </button>{' '}
              <button data-export={s.id} onClick={() => exportSave(s.id)}>
                Export
              </button>{' '}
              <button data-delete={s.id} onClick={() => remove(s.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
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
