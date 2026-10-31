// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game, draws the map and turns the
// player's clicks and keys into commands. The map's view state (view.ts)
// takes the WebGUI's view events and the player's pointer on the map
// (pointer.ts); the map and the info panel show it.
// The WebGUI's questions and panels open as dialogs (panels.tsx) over the
// page, and the side panel (side.tsx) lists the dialogs it cannot show yet.
// window.fcResult is set once the autoplay rounds are done and play passes
// to the human, or on failure.
//   ?autoplay=N  rounds the human auto-ends its turn first (debug; default 0)
//   ?rules=ID    the ruleset (default classic)
//   ?load=ID     continue the saved game with this id, in place of a new game
//   ?debug       the debug menu: reveal the map, add gold, units and goods, skip turns, show the AI's view
//   ?preset=NAME start straight away from presets/NAME.json (or a URL ending .json): a
//                preset sets the nation, difficulty, options and map seed (debug)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
//   ?renderer=canvas2d  draw with the Canvas 2D fallback, not PixiJS (debug)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { createRoot } from 'react-dom/client';
import { startPage, type ClientExports, type Scope, type ToWorker } from './channel';
import { debugMessage, debugMode, describeAnswer, type DebugRequest } from './debug';
import { dialogs } from './dialogs';
import { commandForKey, type Command } from './input';
import { mapDrawer, type MapView } from './map';
import { DialogHost } from './panels';
import { onCanvas, pointerInput } from './pointer';
import { fileNameOf, importSave } from './save-files';
import { idbSaveStore, type SaveMeta } from './saves';
import { Side, type SideProps } from './side';
import { loadModule } from './teavm';
import { cursor, initialView, panel, reduce, tileOnScreen, W, type ViewEvent, type ViewState } from './view';
import type { GuiHandlers } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
    /** For scripts/rounds.mjs: the AI rounds so far, each as "round,milliseconds". */
    fcRounds?: string[];
    /** For scripts/play.mjs: pan a tile into view if needed; its centre on the map canvas. */
    fcReveal?: (x: number, y: number) => [number, number];
    /** For scripts/play.mjs: the view state, without its map, the cursor, and its tile's centre in the viewport. */
    fcView?: () => Omit<ViewState, 'map'> & {
      cursor: ReturnType<typeof cursor>;
      cursorOnScreen: [number, number] | null;
    };
    /** For scripts: the WebGUI dialogs that had no Browser UI, by method, each time one was asked. */
    fcUnasked?: string[];
  }
}

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
const rules = params.get('rules') ?? 'classic';
const loadId = params.has('load') ? Number(params.get('load')) : undefined;
const preset = params.get('preset');
const debug = debugMode(params);
const tileset = params.get('tileset');
const mapHost = document.getElementById('map')!;
/** The map's size: its host's box, which the page's CSS gives what the side panel leaves. */
const mapSize = (): [number, number] => [mapHost.clientWidth, mapHost.clientHeight];
const map = mapDrawer(
  mapHost,
  mapSize(),
  'art/',
  tileset ? `${tileset}.json` : undefined,
  params.get('renderer') === 'canvas2d',
);
const rounds: string[] = [];
window.fcRounds = rounds;
let drawn = Promise.resolve();

const dialogQueue = dialogs();
const side: Omit<SideProps, 'run' | 'save' | 'load' | 'remove' | 'exportSave' | 'importFile'> = {
  turn: '-',
  statusLine: '',
  info: '',
  unasked: [],
  status: 'starting...',
  orders: [],
  saves: [],
  saveNote: '',
};
/** The debug menu's state: what the last action answered, and what to do with a request. */
let debugNote = '';
let debugRequest: (r: DebugRequest) => void = () => {};
let debugSkip: (n: number) => void = () => {};
const store = idbSaveStore();
/** Show the saves in the list; no storage (a private window, say) is an empty list. */
function listSaves() {
  store
    .list()
    .then((saves) => (side.saves = saves))
    .catch((ex: unknown) => (side.saveNote = `Saves unavailable: ${String(ex)}`))
    .finally(renderSide);
}
/** Hand the bytes to the browser as a file download. */
function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let saveGame: (name: string) => void = () => {};
let runCommand: (c: Command) => void = () => {};
const sideRoot = createRoot(document.getElementById('side')!);
function renderSide() {
  sideRoot.render(
    <>
      <Side
        {...side}
        debug={
          debug
            ? { at: cursor(view)?.at ?? null, note: debugNote, request: debugRequest, skipTurns: debugSkip }
            : undefined
        }
        run={(c) => runCommand(c)}
        save={(name) => saveGame(name)}
        load={(id) => {
          // A new page, with a new client Engine, is the cleanest way to a loaded game.
          const next = new URLSearchParams({ load: String(id) });
          const tileset = params.get('tileset');
          if (tileset) next.set('tileset', tileset);
          location.search = next.toString();
        }}
        remove={(id) => {
          side.saveNote = 'Deleting...';
          renderSide();
          store
            .remove(id)
            .then(() => (side.saveNote = 'Deleted'))
            .catch((ex: unknown) => (side.saveNote = `Delete failed: ${String(ex)}`))
            .finally(listSaves);
        }}
        exportSave={(id) => {
          const meta = side.saves.find((s) => s.id === id);
          store
            .get(id)
            .then((bytes) => {
              if (!meta || !bytes) throw new Error('no such save');
              download(bytes, fileNameOf(meta.name));
              side.saveNote = `Exported: ${meta.name}`;
            })
            .catch((ex: unknown) => (side.saveNote = `Export failed: ${String(ex)}`))
            .finally(renderSide);
        }}
        importFile={(file) => {
          side.saveNote = 'Importing...';
          renderSide();
          file
            .arrayBuffer()
            .then((buffer) => importSave(store, file.name, new Uint8Array(buffer), Date.now()))
            .then((meta) => (side.saveNote = `Imported: ${meta.name}`))
            .catch((ex: unknown) => (side.saveNote = `Import failed: ${ex instanceof Error ? ex.message : String(ex)}`))
            .finally(listSaves);
        }}
      />
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
/** The size the map was last given, to skip the ResizeObserver's calls that change nothing. */
let mapGiven: [number, number] = [0, 0];
function resize() {
  const [w, h] = mapSize();
  if (w === mapGiven[0] && h === mapGiven[1]) return;
  mapGiven = [w, h];
  map.resize(mapGiven);
  dispatch({ k: 'resize', width: w, height: h });
}
resize();
new ResizeObserver(resize).observe(mapHost);

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
  const c = cursor(view);
  return { ...rest, cursor: c, cursorOnScreen: c && tileOnScreen(view, c.at) };
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
  const state = { status, rules, preset, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  side.status = JSON.stringify(state, null, 1);
  renderSide();
}

window.fcUnasked = [];
const gui: GuiHandlers = {
  events: {
    activeUnit: (e) => {
      // The Engine says which orders the active unit can take now.
      side.orders = e.orders;
      dispatch({ k: 'activeUnit', ...e });
    },
    selectedTile: (e) => dispatch({ k: 'selectedTile', ...e }),
    focus: (e) => dispatch({ k: 'focus', ...e }),
    information: (e) => dialogQueue.show('information', e),
    error: (e) => {
      console.error(e.text);
      dialogQueue.show('error', e);
    },
    eventPanel: (e) => dialogQueue.show('eventPanel', e),
    highScores: (e) => dialogQueue.show('highScores', e),
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
    goods: (q) => dialogQueue.ask('goods', q),
    negotiation: (q) => dialogQueue.ask('negotiation', q),
    names: (q) => dialogQueue.ask('names', q),
  },
};

function drawMap(m: MapView) {
  side.turn = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  side.statusLine = m.statusLine;
  renderSide();
  dispatch({ k: 'map', map: m });
  drawn = map.draw(m);
}

const dragged = pointerInput(mapHost, { view: () => view, dispatch, tileAt: (px, py) => map.tileAt(px, py) });

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
    const at = onCanvas(mapHost, e);
    const tile = at && !dragged() ? map.tileAt(...at) : null;
    if (tile) client.click(...tile);
  });
}

/** A preset's JSON: a bare name is presets/NAME.json of this build. */
async function fetchPreset(name: string): Promise<string> {
  const url = name.endsWith('.json') ? name : `presets/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`preset ${name}: ${url} gave ${res.status}`);
  return res.text();
}

async function run() {
  const data = (await (await fetch(dataUrl)).json()) as string[];
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const presetJson = preset ? await fetchPreset(preset) : '';
  const client = startPage({
    worker,
    loadClient: () => loadModule<ClientExports>(runtimeUrl, clientUrl),
    data,
    rules,
    load: loadId,
    preset: presetJson,
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
        case 'saved': {
          const meta = JSON.parse(detail) as SaveMeta;
          side.saveNote = `Saved: ${meta.name}`;
          return listSaves();
        }
        case 'saveFailed':
          side.saveNote = `Save failed: ${detail}`;
          return renderSide();
        case 'loadFailed':
          return show('failed', { error: detail });
        case 'debug':
          debugNote = describeAnswer(detail);
          return renderSide();
        case 'debugFailed':
          debugNote = `Failed: ${detail}`;
          return renderSide();
        case 'commandFailed':
          return console.error('command failed:', detail);
      }
    },
  });
  const exports = await client;
  saveGame = (name) => {
    side.saveNote = 'Saving...';
    renderSide();
    const m: ToWorker = { k: 'save', active: exports.activeUnitId(), name };
    worker.postMessage(m);
  };
  debugRequest = (r) => worker.postMessage(debugMessage(r));
  debugSkip = (n) => {
    if (n > 0) exports.skipTurns(n);
  };
  playWith(exports);
}

listSaves();
show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
