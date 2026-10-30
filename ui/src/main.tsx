// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game, draws the map and turns the
// player's clicks and keys into commands. The map's view state (view.ts)
// takes the WebGUI's view events and the player's drags, wheel zooms,
// edge scrolling and pointer moves; the map and the info panel show it.
// The WebGUI's questions and panels open as dialogs (panels.tsx) over the
// page, and the side panel (side.tsx) lists the dialogs it cannot show yet.
// window.fcResult is set once the autoplay rounds are done and play passes
// to the human, or on failure.
//   ?autoplay=N  rounds the human auto-ends its turn first (debug; default 0)
//   ?rules=ID    the ruleset (default classic)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
//   ?renderer=canvas2d  draw with the Canvas 2D fallback, not PixiJS (debug)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { createRoot } from 'react-dom/client';
import { startPage, type ClientExports, type Scope } from './channel';
import { dialogs } from './dialogs';
import { commandForKey, type Command } from './input';
import { mapDrawer, type MapView } from './map';
import { DialogHost } from './panels';
import { Side, type SideProps } from './side';
import { loadModule } from './teavm';
import {
  cursor,
  edgeScroll,
  initialView,
  panel,
  reduce,
  tileOnScreen,
  W,
  type ViewEvent,
  type ViewState,
} from './view';
import type { GuiHandlers } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
    /** For scripts/play.mjs: pan a tile into view if needed; its centre on the map canvas. */
    fcReveal?: (x: number, y: number) => [number, number];
    /** For scripts/play.mjs: the view state, without its map, and where the cursor is. */
    fcView?: () => Omit<ViewState, 'map'> & { cursor: ReturnType<typeof cursor> };
    /** For scripts: the WebGUI dialogs that had no Browser UI, by method, each time one was asked. */
    fcUnasked?: string[];
  }
}

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
const rules = params.get('rules') ?? 'classic';
const tileset = params.get('tileset');
const mapHost = document.getElementById('map')!;
/** The map's size for the window's: all of it but the side panel. */
const mapSizeForWindow = (): [number, number] => [Math.max(320, innerWidth - 360), Math.max(240, innerHeight)];
const map = mapDrawer(
  mapHost,
  mapSizeForWindow(),
  'art/',
  tileset ? `${tileset}.json` : undefined,
  params.get('renderer') === 'canvas2d',
);
const rounds: string[] = [];
let drawn = Promise.resolve();

const dialogQueue = dialogs();
const side: Omit<SideProps, 'run'> = { turn: '-', info: '', unasked: [], status: 'starting...' };
let runCommand: (c: Command) => void = () => {};
const sideRoot = createRoot(document.getElementById('side')!);
function renderSide() {
  sideRoot.render(
    <>
      <Side {...side} run={(c) => runCommand(c)} />
      <DialogHost dialogs={dialogQueue} goTo={(at) => dispatch({ k: 'focus', tile: null, at })} />
    </>,
  );
}

let view = initialView;
function dispatch(e: ViewEvent) {
  view = reduce(view, e);
  map.show(view);
  showPanel();
}
function resize() {
  const size = mapSizeForWindow();
  map.resize(size);
  dispatch({ k: 'resize', width: size[0], height: size[1] });
}
resize();
addEventListener('resize', resize);

window.fcReveal = (x, y) => {
  const [px, py] = tileOnScreen(view, [x, y]);
  const margin = W * view.zoom;
  const [vw, vh] = view.viewport;
  if (px < margin || py < margin || px > vw - margin || py > vh - margin) {
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
  side.info = lines.join('\n');
  renderSide();
}

function show(status: string, extra: Record<string, unknown> = {}) {
  const state = { status, rules, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  side.status = JSON.stringify(state, null, 1);
  renderSide();
}

window.fcUnasked = [];
const gui: GuiHandlers = {
  events: {
    activeUnit: (e) => dispatch({ k: 'activeUnit', ...e }),
    selectedTile: (e) => dispatch({ k: 'selectedTile', ...e }),
    focus: (e) => dispatch({ k: 'focus', ...e }),
    information: (e) => dialogQueue.show('information', e),
    error: (e) => {
      console.error(e.text);
      dialogQueue.show('error', e);
    },
    eventPanel: (e) => dialogQueue.show('eventPanel', e),
    messages: (e) => {
      if (e.messages.length > 0) dialogQueue.show('messages', e);
    },
    unasked: (e) => {
      console.warn(`WebGUI: no dialog yet for ${e.method}; FreeCol's default was used`);
      side.unasked = [...side.unasked, e.method];
      window.fcUnasked = side.unasked;
      renderSide();
    },
  },
  questions: {
    confirm: (q) => dialogQueue.ask('confirm', q),
    choice: (q) => dialogQueue.ask('choice', q),
    input: (q) => dialogQueue.ask('input', q),
  },
};

function drawMap(m: MapView) {
  side.turn = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  renderSide();
  dispatch({ k: 'map', map: m });
  drawn = map.draw(m);
}

/** Pointer at the map's edge (view.ts, edgeScroll), for EDGE_DELAY ms, scrolls it by EDGE_SPEED a frame. */
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
    const [ex, ey] = pointer && !from ? edgeScroll(pointer, view.viewport) : [0, 0];
    if (!ex && !ey) edgeSince = 0;
    else if (!edgeSince) edgeSince = now;
    else if (now - edgeSince >= EDGE_DELAY) dispatch({ k: 'pan', dx: ex * EDGE_SPEED, dy: ey * EDGE_SPEED });
    requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
  return () => moved > 4;
}
const dragged = moveWith();

/** Hook the player's input up to the client Engine's commands. */
function playWith(client: ClientExports) {
  const run = (c: Command) => {
    if (c.k === 'move') client.move(c.direction);
    else client[c.k]();
  };
  runCommand = run;
  addEventListener('keydown', (e) => {
    // An open dialog has the keys (panels.tsx).
    if (e.altKey || e.ctrlKey || e.metaKey || dialogQueue.current()) return;
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
