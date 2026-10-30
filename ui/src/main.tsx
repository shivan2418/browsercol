// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game, draws the map and turns the
// player's clicks and keys into commands. The map's view state (view.ts)
// takes the WebGUI's view events and the player's drags, wheel zooms,
// edge scrolling and pointer moves; the map and the info panel show it.
// window.fcResult is set once the autoplay rounds are done and play passes
// to the human, or on failure.
//   ?autoplay=N  rounds the human auto-ends its turn first (debug; default 0)
//   ?rules=ID    the ruleset (default classic)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
//   ?renderer=canvas2d  draw with the Canvas 2D fallback, not PixiJS (debug)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { startPage, type ClientExports, type Scope } from './channel';
import { commandForKey, type Command } from './input';
import { mapDrawer, type MapView } from './map';
import { loadModule } from './teavm';
import { cursor, initialView, panel, reduce, tileOnScreen, W, type ViewEvent, type ViewState } from './view';
import type { GuiHandlers } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
    /** For scripts/play.mjs: pan a tile into view if needed; its centre on the map canvas. */
    fcReveal?: (x: number, y: number) => [number, number];
    /** For scripts/play.mjs: the view state, without its map, and where the cursor is. */
    fcView?: () => Omit<ViewState, 'map'> & { cursor: ReturnType<typeof cursor> };
  }
}

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
const rules = params.get('rules') ?? 'classic';
const tileset = params.get('tileset');
const out = document.getElementById('out')!;
const turn = document.getElementById('turn')!;
const info = document.getElementById('info')!;
const mapHost = document.getElementById('map')!;
const viewport: [number, number] = [Math.max(320, innerWidth - 360), Math.max(240, innerHeight)];
const map = mapDrawer(
  mapHost,
  viewport,
  'art/',
  tileset ? `${tileset}.json` : undefined,
  params.get('renderer') === 'canvas2d',
);
const rounds: string[] = [];
let drawn = Promise.resolve();

let view = initialView;
function dispatch(e: ViewEvent) {
  view = reduce(view, e);
  map.show(view);
  showPanel();
}
dispatch({ k: 'resize', width: viewport[0], height: viewport[1] });

window.fcReveal = (x, y) => {
  const [px, py] = tileOnScreen(view, [x, y]);
  const margin = W * view.zoom;
  if (px < margin || py < margin || px > viewport[0] - margin || py > viewport[1] - margin) {
    dispatch({ k: 'focus', tile: null, at: [x, y] });
  }
  return tileOnScreen(view, [x, y]);
};

window.fcView = () => {
  const { map: _, ...rest } = view;
  return { ...rest, cursor: cursor(view) };
};

/** FreeCol's InfoPanel, as text: the active unit, and the tile under the pointer. */
function showPanel() {
  const { unit, tile } = panel(view);
  const lines = unit ? [unit.label, `Moves: ${unit.moves}`, ...unit.cargo.map((c) => `  ${c}`)] : ['No active unit'];
  if (tile) lines.push('', tile.name ?? 'Unexplored', ...(tile.owner ? [tile.owner.name] : []));
  info.textContent = lines.join('\n');
}

function show(status: string, extra: Record<string, unknown> = {}) {
  const state = { status, rules, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  out.textContent = JSON.stringify(state, null, 1);
}

// Stopgap until the Browser UI has its own dialogs (#18): the browser's
// native ones, where dismissing answers as a closed dialog does.
const gui: GuiHandlers = {
  events: {
    activeUnit: (e) => dispatch({ k: 'activeUnit', ...e }),
    selectedTile: (e) => dispatch({ k: 'selectedTile', ...e }),
    focus: (e) => dispatch({ k: 'focus', ...e }),
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

function drawMap(m: MapView) {
  turn.textContent = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  dispatch({ k: 'map', map: m });
  drawn = map.draw(m);
}

/** Pointer within this many pixels of the map's edge, for EDGE_DELAY ms, scrolls it by EDGE_SPEED a frame. */
const EDGE = 24;
const EDGE_DELAY = 300;
const EDGE_SPEED = 16;

/** Wheel deltas, in pixels, that make one zoom step: a trackpad's small deltas add up. */
const WHEEL_STEP = 40;

/** A pointer event's pixel on the map canvas, or null before there is one. */
function onCanvas(e: { clientX: number; clientY: number }): [number, number] | null {
  const canvas = mapHost.querySelector('canvas');
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

/** Drag, wheel and edge scrolling move the view; the pointer's tile is hovered. Returns whether a click was a drag. */
function moveWith(): () => boolean {
  let wheel = 0;
  let from: [number, number] | null = null;
  let moved = 0;
  mapHost.addEventListener('pointerdown', (e) => {
    from = [e.clientX, e.clientY];
    moved = 0;
  });
  addEventListener('pointermove', (e) => {
    if (!from) return;
    const [dx, dy] = [e.clientX - from[0], e.clientY - from[1]];
    moved += Math.abs(dx) + Math.abs(dy);
    from = [e.clientX, e.clientY];
    dispatch({ k: 'pan', dx, dy });
  });
  addEventListener('pointerup', () => (from = null));
  mapHost.addEventListener(
    'wheel',
    (e) => {
      const at = onCanvas(e);
      if (!at) return;
      e.preventDefault();
      // Line and page deltas (Firefox's mouse wheel) count as a step each.
      wheel += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_STEP;
      if (Math.abs(wheel) < WHEEL_STEP) return;
      dispatch({ k: 'zoom', steps: wheel < 0 ? 1 : -1, at });
      wheel = 0;
    },
    { passive: false },
  );

  // The pointer over the map, and since when it has been at an edge.
  let pointer: [number, number] | null = null;
  let edgeSince = 0;
  const edge = (p: [number, number]): [number, number] => [
    p[0] < EDGE ? 1 : p[0] > viewport[0] - EDGE ? -1 : 0,
    p[1] < EDGE ? 1 : p[1] > viewport[1] - EDGE ? -1 : 0,
  ];
  mapHost.addEventListener('pointermove', (e) => {
    pointer = onCanvas(e);
    const at = pointer && map.tileAt(...pointer);
    const was = view.hover;
    if (at?.[0] !== was?.[0] || at?.[1] !== was?.[1]) dispatch({ k: 'hover', at: at ?? null });
  });
  mapHost.addEventListener('pointerleave', () => {
    pointer = null;
    if (view.hover) dispatch({ k: 'hover', at: null });
  });
  const scroll = (now: number) => {
    const [ex, ey] = pointer && !from ? edge(pointer) : [0, 0];
    if (!ex && !ey) edgeSince = 0;
    else if (!edgeSince) edgeSince = now;
    else if (now - edgeSince >= EDGE_DELAY) dispatch({ k: 'pan', dx: ex * EDGE_SPEED, dy: ey * EDGE_SPEED });
    requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
  return () => moved > 4;
}
const dragged = moveWith();

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
    const at = onCanvas(e);
    const tile = at && !dragged() ? map.tileAt(...at) : null;
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
