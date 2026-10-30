// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game, draws the map and turns the
// player's clicks and keys into commands. window.fcResult is set once the
// autoplay rounds are done and play passes to the human, or on failure.
//   ?autoplay=N  rounds the human auto-ends its turn first (debug; default 0)
//   ?rules=ID    the ruleset (default classic)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { startPage, type ClientExports, type Scope } from './channel';
import { commandForKey, type Command } from './input';
import { mapDrawer, type MapView } from './map';
import { loadModule } from './teavm';
import type { GuiHandlers } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
    /** For scripts/play.mjs: pan a tile into view if needed; its centre on the map canvas. */
    fcReveal?: (x: number, y: number) => [number, number];
  }
}

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
const rules = params.get('rules') ?? 'classic';
const tileset = params.get('tileset');
const out = document.getElementById('out')!;
const turn = document.getElementById('turn')!;
const mapHost = document.getElementById('map')!;
const map = mapDrawer(mapHost, 'art/', tileset ? `${tileset}.json` : undefined);
const rounds: string[] = [];
window.fcReveal = (x, y) => map.reveal(x, y);
let drawn = Promise.resolve();

function show(status: string, extra: Record<string, unknown> = {}) {
  const state = { status, rules, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  out.textContent = JSON.stringify(state, null, 1);
}

// Stopgap until the Browser UI has its own dialogs (#18): the browser's
// native ones, where dismissing answers as a closed dialog does.
const gui: GuiHandlers = {
  events: {
    information: (e) => console.info(e.text),
    error: (e) => console.error(e.text),
  },
  questions: {
    confirm: (q) => confirm(`${q.text}\n\nOK: ${q.ok}\nCancel: ${q.cancel}`),
    choice: (q) => {
      const n = prompt(`${q.text}\n\n${q.choices.map((c, i) => `${i}: ${c.text}`).join('\n')}`);
      return n === null || n.trim() === '' ? null : Number(n);
    },
    input: (q) => prompt(q.text, q.value ?? ''),
  },
};

function drawMap(view: MapView) {
  turn.textContent = `${view.turn}${view.ourTurn ? '' : ' (AI playing)'}`;
  drawn = map.draw(view);
}

/** The commands of the side panel's buttons, by their data-command. */
const BUTTONS: Record<string, Command> = {
  nextUnit: { k: 'nextUnit' },
  buildColony: { k: 'buildColony' },
  endTurn: { k: 'endTurn' },
};

/** Hook the player's input up to the client Engine's commands. */
function playWith(client: ClientExports) {
  const run = (c: Command) => {
    if (c.k === 'move') client.move(c.direction);
    else client[c.k]();
  };
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const c = commandForKey(e);
    if (!c) return;
    e.preventDefault();
    run(c);
  });
  mapHost.addEventListener('click', (e) => {
    const canvas = mapHost.querySelector('canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const tile = map.tileAt(e.clientX - r.left, e.clientY - r.top);
    if (tile) client.click(...tile);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-command]')) {
    const c = BUTTONS[button.dataset.command ?? ''];
    if (c) button.addEventListener('click', () => run(c));
  }
}

async function run() {
  const data = (await (await fetch(dataUrl)).json()) as string[];
  const client = startPage({
    worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    loadClient: () => loadModule<ClientExports>(runtimeUrl, clientUrl),
    data,
    rules,
    autoplay,
    scope: globalThis as unknown as Scope,
    gui,
    onEvent: async (name, detail) => {
      switch (name) {
        case 'gameStarted':
        case 'map':
          return drawMap(JSON.parse(detail) as MapView);
        case 'round':
          rounds.push(detail);
          return show('running');
        case 'finished':
          await drawn; // let the last map land before reporting
          return show('finished', { turn: detail });
        case 'failed':
          return show('failed', { error: detail });
        case 'commandFailed':
          return console.error('command failed:', detail);
      }
    },
  });
  playWith(await client);
}

show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
