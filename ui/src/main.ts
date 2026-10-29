// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game and draws the map. The result
// lands in window.fcResult once the game finishes or fails.
//   ?autoplay=N  rounds the human auto-ends its turn (debug; default 10)
//   ?rules=ID    the ruleset (default classic)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { startPage, type ClientExports, type Scope } from './channel';
import { mapDrawer, type MapView } from './map';
import { loadModule } from './teavm';
import type { GuiHandlers } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
  }
}

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '10');
const rules = params.get('rules') ?? 'classic';
const out = document.getElementById('out')!;
const map = mapDrawer(document.getElementById('map')!);
const rounds: string[] = [];
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

async function run() {
  const data = (await (await fetch(dataUrl)).json()) as string[];
  startPage({
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
          drawn = map.draw(JSON.parse(detail) as MapView);
          return;
        case 'round':
          rounds.push(detail);
          return show('running');
        case 'finished':
          await drawn; // let the last map land before reporting
          return show('finished', { turn: detail });
        case 'failed':
          return show('failed', { error: detail });
      }
    },
  });
}

show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
