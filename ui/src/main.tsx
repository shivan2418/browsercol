// Page script: hosts the client Engine (client.wasm) on the main thread and
// the server Engine in worker.ts, runs a game, draws the map and turns the
// player's clicks and keys into commands. The map's view state (view.ts)
// takes the WebGUI's view events and the player's pointer on the map
// (pointer.ts); the map and the info panel show it.
// The WebGUI's questions and panels open as dialogs (panels.tsx) over the
// page, the colony panel among them, shown again with each map; the menu bar
// (frame.tsx) over the map shows the status line; and the
// side panel (side.tsx) lists the dialogs it cannot show yet.
// window.fcResult is set once the autoplay rounds are done and play passes
// to the human, or on failure.
//   ?autoplay=N  rounds the human auto-ends its turn first (debug; default 0)
//   ?rules=ID    the ruleset (default classic)
//   ?load=ID     continue the saved game with this id, in place of a new game
//   ?debug       the debug menu: reveal the map, add gold, units and goods, skip turns, show the AI's view
//   ?skipstart   no start screen: start a game with FreeCol's defaults (debug; the browser scripts use it)
//   ?preset=NAME start straight away from presets/NAME.json (or a URL ending .json): a
//                preset sets the nation, difficulty, options and map seed (debug)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
//   ?renderer=canvas2d  draw with the Canvas 2D fallback, not PixiJS (debug)
//   ?theme=dark  the dark palette of theme.css, in place of parchment
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { startPage, type ClientExports, type Scope, type ToWorker } from './channel';
import { debugMessage, debugMode, describeAnswer, type DebugRequest } from './debug';
import { ColonyActions, ColonyTiles, type ColonyMoves, type DrawTiles } from './colony-panel';
import { dialogs } from './dialogs';
import { MENUS, MenuBar, type Menu } from './frame';
import { gameMenu, ordersMenu, viewMenu, type MenuActions } from './menus';
import { commandForKey, type Command } from './input';
import { PreferencesDialog } from './prefs-dialog';
import { blinkMs, loadPrefs, moveMs, savePrefs, type Prefs } from './prefs';
import { mapDrawer, type MapView } from './map';
import { europeButtons } from './europe-client';
import { DialogHost, type Art, type ReportButtons, type RouteButtons } from './panels';
import { reportForKey } from './report-keys';
import { ReportContext, colopediaMenu, reportMenu, type ReportActions } from './reports';
import type { PathStep } from './tileset';
import { blockBrowserMenu, onCanvas, pointerInput, rightClickInput } from './pointer';
import { ContextMenuContext, PopupMenu, parseMenu, type ContextMenus, type Popup } from './popup-menu';
import { StartScreen } from './start-screen';
import { presetJson, startOptions } from './start';
import { fileNameOf, importSave } from './save-files';
import { idbSaveStore, type SaveMeta } from './saves';
import { Side, type SideProps } from './side';
import { TurnBanner, turnNotice, type TurnFacts, type TurnNotice } from './turn-banner';
import { loadModule } from './teavm';
import { cursor, initialView, panel, reduce, tileOnScreen, W, type ViewEvent, type ViewState } from './view';
import type { GuiEvents, GuiHandlers } from './webgui';

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
/** No start screen: a debug start, a loaded game, or ?skipstart. */
const skipStart = params.has('skipstart') || params.has('preset') || loadId !== undefined;
const debug = debugMode(params);
const tileset = params.get('tileset');
const theme = params.get('theme');
if (theme) document.documentElement.dataset.theme = theme;
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
/** The player's nation, as the last map said, and what the start screen sent; both for window.fcResult. */
let nation = '';
let choice = '';

const dialogQueue = dialogs();
const side: Omit<SideProps, 'run' | 'save' | 'load' | 'remove' | 'exportSave' | 'importFile'> = {
  turn: '-',
  info: '',
  unasked: [],
  status: 'starting...',
  orders: [],
  route: null,
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
/** The turn report's buttons, once the client Engine has loaded. */
let reportButtons: ReportButtons = { groupBy: () => {}, filter: () => {}, ignore: () => {} };
/** The trade routes panel's buttons, once the client Engine has loaded. */
let routeButtons: RouteButtons = { save: () => {}, remove: () => {}, assign: () => {} };
/** The art of the first resource key the Tileset has, as a URL to show in a dialog, once its manifest has loaded. */
let artReady = false;
const art: Art = (keys) => {
  const res = map.resources();
  const key = res && keys.find((k) => res.has(k));
  return res && key ? `art/${res.path(key)}` : null;
};
let runCommand: (c: Command) => void = () => {};
/** The colony panel draws its tiles from the map, as the map draws them. */
const drawColonyTiles: DrawTiles = (host, centre, tiles, top) => map.drawTiles(host, centre, tiles, top);
/** The colonists' moves and the ships' loading in the colony panel, once the client Engine has loaded (Commands.java). */
let colonyClient: ClientExports | null = null;
const colonyMoves: ColonyMoves = {
  work: (unit, location) => colonyClient?.work(unit, location),
  putOutside: (unit) => colonyClient?.putOutsideColony(unit),
  changeWork: (unit, goods) => colonyClient?.changeWorkType(unit, goods),
  setQueue: (colony, types) => colonyClient?.setBuildQueue(colony, types.join(',')),
  buy: (colony) => colonyClient?.payForBuilding(colony),
  warehouse: (colony) => colonyClient?.warehouse(colony),
  board: (unit, ship) => colonyClient?.boardShip(unit, ship),
  leaveShip: (unit) => colonyClient?.leaveShip(unit),
  load: (ship, goods, ask) => colonyClient?.loadGoods(ship, goods, ask),
  unload: (ship, goods, stack, ask) => colonyClient?.unloadGoods(ship, goods, stack, ask),
};
/** FreeCol's status line: the score, the gold, the tax and the year. */
let statusLine = '';
/** The turn the last map was of, and the banner over the map about it (turn-banner.tsx). */
let lastTurn: TurnFacts | null = null;
let banner: TurnNotice | null = null;
/** What the links in a report do, once the client Engine has loaded. */
const reportActions: ReportActions = {
  open: (name) => colonyClient?.report(name),
  detail: (name, id) => colonyClient?.reportDetail(name, id),
  colony: (id) => colonyClient?.showColony(id),
  europe: () => runCommand({ k: 'showEurope' }),
  goTo: (at) => dispatch({ k: 'focus', tile: null, at }),
};
/** The player's preferences, and whether their window is open. */
let prefs: Prefs = loadPrefs();
let prefsOpen = false;
map.setMotion(moveMs(prefs), blinkMs(prefs));
/** Whether the client Engine has loaded, so the menus' game commands work. */
let menuReady = false;
/** What the Game, Orders and View menus do (menus.ts). */
const menuActions = (): MenuActions => ({
  ready: menuReady,
  orders: side.orders,
  hasActiveUnit: view.active !== null,
  run: (c) => runCommand(c),
  newGame: () => {
    // A new page shows the start screen again.
    const next = new URLSearchParams();
    if (tileset) next.set('tileset', tileset);
    location.search = next.toString();
  },
  save: () => saveGame(''),
  open: () => document.getElementById('saves')?.scrollIntoView({ block: 'nearest' }),
  preferences: () => {
    prefsOpen = true;
    renderSide();
  },
  zoom: (steps) => dispatch({ k: 'zoom', steps, at: [view.viewport[0] / 2, view.viewport[1] / 2] }),
  centreOnUnit: () => dispatch({ k: 'focus', tile: null, at: view.active?.tile ?? null }),
});
/** The menus, with the entries each has now. */
const currentMenus = (): Menu[] => {
  const a = menuActions();
  const items: Record<string, Menu['items']> = {
    Game: gameMenu(a),
    View: viewMenu(a),
    Orders: ordersMenu(a),
    Report: reportMenu(reportActions.open),
    Colopedia: colopediaMenu(reportActions.open),
  };
  return MENUS.map((name) => ({ name, items: items[name] ?? [] }));
};
const menuRoot = createRoot(document.getElementById('menubar')!);
/** Our colony as the colony panel shows it, once the client Engine has loaded (ClientExports.colony). */
let colonyNow: (id: string) => string = () => 'null';
let colonyPull = false;
/**
 * Show the colony panels again soon, once: the Engine's events come from its threads, and the pull calls
 * back into the Engine, so it runs after the event, and a burst of updates pulls once.
 */
function pullColonies() {
  if (colonyPull) return;
  colonyPull = true;
  setTimeout(() => {
    colonyPull = false;
    refreshColonies();
  }, 0);
}
/** Show the open and queued colony panels again, as the colonies may have changed. */
function refreshColonies() {
  for (const open of dialogQueue.shown('colony')) {
    const json = colonyNow(open.id);
    // JSON.parse keeps the Engine's key order, so an unchanged colony stringifies to the same text.
    if (json === 'null' || json === JSON.stringify(open)) continue;
    dialogQueue.replace('colony', JSON.parse(json) as GuiEvents['colony'], (c) => c.id === open.id);
  }
}
/** The right-click menu that is open, if any. */
let popup: Popup | null = null;
function showPopup(next: Popup | null) {
  popup = next;
  renderSide();
}
/** The Engine's right-click menus, once the client Engine has loaded (Menus.java). */
let menuClient: ClientExports | null = null;
const contextMenus: ContextMenus = {
  unit: (id) => (menuClient ? parseMenu(menuClient.unitMenu(id)) : null),
  goods: (location, type, amount) => (menuClient ? parseMenu(menuClient.goodsMenu(location, type, amount)) : null),
  show: (menu, x, y) => showPopup({ menu, x, y }),
};
const sideRoot = createRoot(document.getElementById('side')!);
function renderSide() {
  menuRoot.render(<MenuBar menus={currentMenus()} status={statusLine} />);
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
      <ColonyTiles.Provider value={drawColonyTiles}>
        <ColonyActions.Provider value={colonyMoves}>
          <ContextMenuContext.Provider value={contextMenus}>
            <ReportContext.Provider value={reportActions}>
              <DialogHost
                dialogs={dialogQueue}
                goTo={(at) => dispatch({ k: 'focus', tile: null, at })}
                art={art}
                colopedia={(type) => menuClient?.menuEntry(`colopedia:${type}`)}
                string={(key) => map.resources()?.string(key) ?? ''}
                report={{
                  groupBy: (value) => reportButtons.groupBy(value),
                  filter: (index, shown) => reportButtons.filter(index, shown),
                  ignore: (index, ignore) => reportButtons.ignore(index, ignore),
                }}
                routes={{
                  save: (d) => routeButtons.save(d),
                  remove: (id) => routeButtons.remove(id),
                  assign: (unit, route) => routeButtons.assign(unit, route),
                }}
              />
            </ReportContext.Provider>
          </ContextMenuContext.Provider>
        </ColonyActions.Provider>
      </ColonyTiles.Provider>
      {prefsOpen && (
        <PreferencesDialog
          prefs={prefs}
          change={(p) => {
            prefs = p;
            savePrefs(p);
            map.setMotion(moveMs(p), blinkMs(p));
            renderSide();
          }}
          close={() => {
            prefsOpen = false;
            renderSide();
          }}
        />
      )}
      <TurnBanner notice={banner} />
      {popup && <PopupMenu popup={popup} run={(id) => menuClient?.menuEntry(id)} close={() => showPopup(null)} />}
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
  const state = { status, rules, preset, choice, nation, autoplay, renderer: map.renderer(), rounds, ...extra };
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
      side.route = e.route;
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
    indianSettlement: (e) => dialogQueue.show('indianSettlement', e),
    tilePanel: (e) => dialogQueue.show('tilePanel', e),
    colopedia: (e) => dialogQueue.replace('colopedia', e),
    highScores: (e) => dialogQueue.show('highScores', e),
    tradeRoutes: (e) => dialogQueue.replace('tradeRoutes', e),
    europe: (e) => dialogQueue.replace('europe', e),
    options: (e) => dialogQueue.replace('options', e, (open) => open.kind === e.kind),
    // A report that is open is replaced: a link in it opens a detail in its place.
    report: (e) => dialogQueue.replace('report', e),
    messages: (e) => {
      if (e.regrouped) dialogQueue.replace('messages', e, (open) => open.title === e.title);
      else if (e.messages.length > 0) dialogQueue.show('messages', e);
    },
    // A colony already open or queued is shown again in its place, else it opens.
    colony: (e) => dialogQueue.replace('colony', e, (open) => open.id === e.id),
    unasked: (e) => {
      console.warn(`WebGUI: no dialog yet for ${e.method}; FreeCol's default was used`);
      side.unasked = [...side.unasked, e.method];
      window.fcUnasked = side.unasked;
      renderSide();
    },
  },
  questions: {
    event: (q) => dialogQueue.ask('event', q),
    confirm: (q) => dialogQueue.ask('confirm', q),
    choice: (q) => dialogQueue.ask('choice', q),
    input: (q) => dialogQueue.ask('input', q),
    amount: (q) => dialogQueue.ask('amount', q),
    goods: (q) => dialogQueue.ask('goods', q),
    endTurn: (q) => dialogQueue.ask('endTurn', q),
    preCombat: (q) => dialogQueue.ask('preCombat', q),
    negotiation: (q) => dialogQueue.ask('negotiation', q),
    names: (q) => dialogQueue.ask('names', q),
    warehouse: (q) => dialogQueue.ask('warehouse', q),
  },
};

function drawMap(m: MapView) {
  nation = m.nation;
  side.turn = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  statusLine = m.statusLine;
  // A new turn's notice stays through the maps of its turn; the AI's goes when play comes back.
  banner = turnNotice(lastTurn, m) ?? (banner?.kind === 'new' && m.ourTurn ? banner : null);
  lastTurn = m;
  renderSide();
  dispatch({ k: 'map', map: m });
  pullColonies();
  drawn = map.draw(m);
  // A dialog shown before the art manifest loaded has no images: draw it again once they can be had.
  if (!artReady) void drawn.then(() => map.resources() && ((artReady = true), renderSide()));
}

blockBrowserMenu(document);
/** The client Engine, once loaded: a held Go To asks it for the path and sends the unit. */
let gotoClient: ClientExports | null = null;
const dragged = pointerInput(mapHost, {
  view: () => view,
  dispatch,
  tileAt: (px, py) => map.tileAt(px, py),
  goto: {
    preview: (tile) =>
      dispatch({
        k: 'preview',
        path: tile && gotoClient ? (JSON.parse(gotoClient.pathTo(...tile)) as PathStep[] | null) : null,
      }),
    go: (tile) => gotoClient?.goTo(...tile),
  },
});

/** Hook the player's input up to the client Engine's commands. */
function playWith(client: ClientExports) {
  const run = (c: Command) => {
    if (c.k === 'move') client.move(c.direction);
    else client[c.k]();
  };
  runCommand = run;
  menuReady = true;
  gotoClient = client;
  renderSide();
  addEventListener('keydown', (e) => {
    // An open dialog has the keys (panels.tsx).
    // A report's hotkey (Shift+F3, ...) opens it over another report, but not over another dialog.
    const report = reportForKey(e);
    if (report && !e.repeat && [undefined, 'report'].includes(dialogQueue.current()?.kind)) {
      e.preventDefault();
      reportActions.open(report);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || dialogQueue.current()) return;
    const c = commandForKey(e);
    if (!c) return;
    e.preventDefault();
    run(c);
  });
  menuClient = client;
  // A right-click on a map tile opens its popup; a dialog over the map has the pointer instead.
  rightClickInput(
    mapHost,
    (px, py) => map.tileAt(px, py),
    (tile, x, y) => {
      const menu = parseMenu(client.tileMenu(...tile));
      showPopup(menu && { menu, x, y });
    },
  );
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

/** The start screen, until the player starts the game: resolves to the preset JSON the choice makes. */
function chooseGame(data: string[]): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((done) => {
    root.render(
      <StartScreen
        options={startOptions(data, rules)}
        start={(c) => {
          root.unmount();
          host.remove();
          done(presetJson(c));
        }}
      />,
    );
  });
}

async function run() {
  const data = (await (await fetch(dataUrl)).json()) as string[];
  const chosen = skipStart ? '' : await chooseGame(data);
  choice = chosen;
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const presetJson = preset ? await fetchPreset(preset) : chosen;
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
        case 'updated':
          // A message from the server has been handled: the open colonies may have changed.
          return pullColonies();
        case 'round':
          rounds.push(detail);
          return show('running');
        case 'finished':
          await drawn; // let the last map land before reporting
          return show('finished', { turn: detail, mapSize: view.map ? [view.map.w, view.map.h] : null });
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
  colonyNow = (id) => exports.colony(id);
  colonyClient = exports;
  debugRequest = (r) => worker.postMessage(debugMessage(r));
  debugSkip = (n) => {
    if (n > 0) exports.skipTurns(n);
  };
  reportButtons = {
    groupBy: (value) => exports.reportGroupBy(value),
    filter: (index, shown) => exports.reportFilter(index, shown),
    ignore: (index, ignore) => exports.reportIgnore(index, ignore),
  };
  routeButtons = {
    save: (d) => exports.saveTradeRoute(JSON.stringify(d)),
    remove: (id) => exports.deleteTradeRoute(id),
    assign: (unit, route) => exports.assignTradeRoute(unit, route ?? ''),
  };
  Object.assign(europeButtons, {
    recruit: (i: number) => exports.recruitUnit(i),
    train: (id: string) => exports.trainUnit(id),
    board: (unit: string, ship: string) => exports.boardShip(unit, ship),
    buy: (goods: string, ship: string) => exports.buyGoods(ship, goods),
    sell: (goods: string, ship: string) => exports.sellGoods(ship, goods),
    sail: (ship: string) => exports.sailToNewWorld(ship),
  });
  playWith(exports);
}

listSaves();
show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
