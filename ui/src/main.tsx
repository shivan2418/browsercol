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
//   (dev server) the page resumes the autosave; ?new starts afresh, ?resume resumes in a built site too
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
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import './theme.css';
import { startPage, type ClientExports, type Scope, type ToWorker } from './channel';
import { debugMessage, debugMode, describeAnswer, type DebugRequest } from './debug';
import { ColonyActions, ColonyTiles, type ColonyMoves, type DrawTiles } from './colony-panel';
import { dialogs } from './dialogs';
import { MENUS, MenuBar, framePlaces, goodsIcons, type Menu } from './frame';
import { gameMenu, ordersMenu, viewMenu, type MenuActions } from './menus';
import { commandForKey, type Command } from './input';
import { PreferencesDialog } from './prefs-dialog';
import {
  blinkMs,
  fromEngine,
  loadPrefs,
  moveMs,
  pageOption,
  savePrefs,
  shownClientOptions,
  startModes,
  MODE_OPTIONS,
  visibleMessages,
  fontScale,
  uiZoom,
  type Prefs,
} from './prefs';
import { clientOptionsGroup, leaves, type OptionGroup } from './options';
import { mapDrawer, type MapView } from './map';
import { europeButtons } from './europe-client';
import { DialogHost, type Art, type ReportButtons, type RouteButtons } from './panels';
import { reportForKey } from './report-keys';
import { ReportContext, colopediaMenu, reportMenu, type ReportActions } from './reports';
import type { ColonyLabels, PathStep } from './tileset';
import { blockBrowserMenu, gotoKeyInput, onCanvas, pointerInput, rightClickInput } from './pointer';
import { ContextMenuContext, PopupMenu, parseMenu, type ContextMenus, type Popup } from './popup-menu';
import { soundPlayer, type AudioManifest } from './sound';
import { StartScreen } from './start-screen';
import { presetJson, startOptions } from './start';
import { fileNameOf, importSave } from './save-files';
import {
  AUTOSAVE_NAME,
  debounced,
  dropOlderAutosaves,
  idbSaveStore,
  isAutosave,
  latestAutosave,
  type SaveMeta,
} from './saves';
import { Side, type SideProps } from './side';
import { shownNotice, TurnBanner, turnNotice, type TurnFacts, type TurnNotice } from './turn-banner';
import { ErrorBanner, addError, engineError, type GameError } from './errors';
import { loadModule } from './teavm';
import { cursor, initialView, panel, reduce, tileOnScreen, W, type Tile, type ViewEvent, type ViewState } from './view';
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
    /** For scripts: the errors the banner has shown (errors.tsx), dismissed or not. */
    fcErrors?: GameError[];
  }
}

/** The errors on the banner (errors.tsx); the player dismisses them. */
let errors: GameError[] = [];
window.fcErrors = [];
/**
 * The banner's own root, made at the first error: it shows even when the page broke before its other roots
 * were made, and a render error elsewhere on the page does not take it down nor render it again and again.
 */
let errorRoot: Root | null = null;
function renderErrors() {
  if (!errorRoot) {
    const host = document.createElement('div');
    host.id = 'errors';
    document.body.append(host);
    errorRoot = createRoot(host);
  }
  errorRoot.render(
    <ErrorBanner
      errors={errors}
      dismiss={() => {
        errors = [];
        renderErrors();
      }}
    />,
  );
}
/** Show an error on the banner, so a game that breaks does not break silently. */
function reportError(title: string, detail: string) {
  // scripts/common.mjs collects the errors by this prefix.
  console.error(`Error banner: ${title}\n${detail}`);
  errors = addError(errors, title, detail);
  window.fcErrors = addError(window.fcErrors ?? [], title, detail);
  renderErrors();
}
const describeError = (ex: unknown) => (ex instanceof Error ? (ex.stack ?? ex.message) : String(ex));
// The page's own errors, which would otherwise show only in the console.
addEventListener('error', (e) => reportError('The page hit an error', describeError(e.error ?? e.message)));
addEventListener('unhandledrejection', (e) => reportError('The page hit an error', describeError(e.reason)));

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
const rules = params.get('rules') ?? 'classic';
let loadId = params.has('load') ? Number(params.get('load')) : undefined;
/** The page picked up the autosave by itself, so a load that fails drops it rather than leave the page stuck. */
let resumed = false;
const preset = params.get('preset');
/** No start screen: a debug start, a loaded game, or ?skipstart. */
let skipStart = params.has('skipstart') || params.has('preset') || loadId !== undefined;
const debug = debugMode(params);
const tileset = params.get('tileset');
const theme = params.get('theme');
if (theme) document.documentElement.dataset.theme = theme;
const mapHost = document.getElementById('map')!;
/** The map's size: its host's box, which the page's CSS gives what the side panel leaves. */
const mapSize = (): [number, number] => [mapHost.clientWidth, mapHost.clientHeight];
/** The preferences as the page loads: some are read only then. */
const prefsAtLoad = loadPrefs();
const map = mapDrawer(
  mapHost,
  mapSize(),
  'art/',
  tileset ? `${tileset}.json` : undefined,
  // FreeCol's Enable OpenGL option off draws with Canvas 2D, as ?renderer=canvas2d does.
  params.get('renderer') === 'canvas2d' || !pageOption(prefsAtLoad, 'model.option.useOpenGL'),
  pageOption(prefsAtLoad, 'model.option.graphicsQuality'),
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
/** Schedule an autosave (set once the client Engine has loaded). */
let autosaveSoon: () => void = () => {};
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
/** The turn in which the Engine last said no unit is left to move, so the banner says to end it. */
let idleTurn: string | null = null;
/** What the links in a report do, once the client Engine has loaded. */
const reportActions: ReportActions = {
  open: (name) => colonyClient?.report(name),
  detail: (name, id) => colonyClient?.reportDetail(name, id),
  colony: (id) => colonyClient?.showColony(id),
  europe: () => runCommand({ k: 'showEurope' }),
  goTo: (at) => dispatch({ k: 'focus', tile: null, at }),
};
/** The player's preferences, and whether their window is open. */
let prefs: Prefs = prefsAtLoad;
let prefsOpen = false;
/** The music and sound effects volume options. */
const volumes = (p: Prefs) => ({
  music: pageOption(p, 'model.option.musicVolume'),
  effects: pageOption(p, 'model.option.soundEffectsVolume'),
});
/** FreeCol's music and sound effects, served under audio/ (build-audio.mjs); null if the manifest is missing. */
const sound = fetch('audio/audio.json')
  .then((res) => (res.ok ? (res.json() as Promise<AudioManifest>) : Promise.reject(new Error(`${res.status}`))))
  .then((manifest) => {
    const player = soundPlayer(manifest, { base: 'audio/' });
    player.setVolumes(volumes(prefs));
    return player;
  })
  .catch((ex: unknown) => {
    console.warn('no sound: audio/audio.json gave', ex);
    return null;
  });
/** GUI.playSound: play a sound by its resource key, or stop the sound effect; in order, once the manifest is in. */
const playSound = (key: string | null) => void sound.then((s) => s?.play(key));
/**
 * FreeCol's compass rose at the map's top right (CornerMapControls), shown by the display compass rose option:
 * a click on it moves the active unit the way it points.
 */
const compass = document.createElement('img');
compass.id = 'compass';
compass.alt = 'Compass rose';
compass.addEventListener('click', (e) => {
  const r = compass.getBoundingClientRect();
  // CornerMapControls: the angle from the centre, a quarter turn and a sixteenth on, in eighths from north.
  let theta =
    Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) + Math.PI / 2 + Math.PI / 8;
  if (theta < 0) theta += 2 * Math.PI;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  if (view.active) runCommand({ k: 'move', direction: directions[Math.floor(theta / (Math.PI / 4)) % 8] });
});
function showCompass(on: boolean) {
  const src = on ? art(['image.skin.compass']) : null;
  if (src) {
    compass.src = src;
    mapHost.append(compass);
  } else compass.remove();
}
// Where the player left each window, for FreeCol's remember panel positions option.
const PLACES_KEY = 'freecol.panelPlaces';
try {
  framePlaces.places = JSON.parse(localStorage.getItem(PLACES_KEY) ?? '{}') as typeof framePlaces.places;
} catch {
  // None kept.
}
framePlaces.saved = () => {
  try {
    localStorage.setItem(PLACES_KEY, JSON.stringify(framePlaces.places));
  } catch {
    // They last until the page closes.
  }
};
/** The preferences the page's look follows: motion, dimming, and FreeCol's display scaling and font size. */
function applyLook(p: Prefs) {
  map.setMotion(moveMs(p), blinkMs(p), p.activeStyle);
  document.body.dataset.dimUnfocused = String(p.dimUnfocused);
  map.setColonyLabels(pageOption(p, 'model.option.displayColonyLabels') as ColonyLabels);
  showCompass(pageOption(p, 'model.option.displayCompassRose'));
  framePlaces.remember = pageOption(p, 'model.option.rememberPanelPositions');
  goodsIcons.max = pageOption(p, 'model.option.guiMaxNumberOfGoodsImages');
  goodsIcons.countFrom = pageOption(p, 'model.option.guiMinNumberToDisplayGoodsCount');
  const root = document.documentElement.style;
  root.setProperty('--ui-zoom', String(uiZoom(p)));
  const f = fontScale(p);
  if (f === 1) for (const t of ['--fs', '--fs-s', '--fs-h']) root.removeProperty(t);
  else
    for (const [t, px] of [
      ['--fs', 15],
      ['--fs-s', 13],
      ['--fs-h', 17],
    ] as const)
      root.setProperty(t, `${Math.round(px * f)}px`);
}
applyLook(prefs);
/** FreeCol's client options as the Preferences window shows them, and their defaults, once the data has loaded. */
let freecolOptions: OptionGroup | null = null;
let freecolDefaults = new Map<string, unknown>();
/** Tell the client Engine FreeCol's client options as the player set them. */
function pushFreecolOptions(values: Prefs['freecol']) {
  for (const [id, v] of Object.entries(values)) colonyClient?.setClientOption(id, String(v));
}
/** Change the preferences: keep them, and make the page and the client Engine follow. */
function setPrefs(p: Prefs) {
  const was = prefs;
  prefs = p;
  savePrefs(p);
  applyLook(p);
  void sound.then((s) => s?.setVolumes(volumes(p)));
  const changed = Object.fromEntries(Object.entries(p.freecol).filter(([id, v]) => was.freecol[id] !== v));
  pushFreecolOptions(changed);
  // The Engine's map says whether the fog of war shows.
  if (MODE_OPTIONS.fog in changed) colonyClient?.refreshMap();
  // The View menu's modes follow their options.
  const modes = startModes(p);
  for (const mode of ['grid', 'borders'] as const) {
    if (view.modes[mode] !== modes[mode]) dispatch({ k: 'toggle', mode });
  }
  if (view.modes.tileText !== modes.tileText) dispatch({ k: 'tileText', text: modes.tileText });
  // The side panel is FreeCol Online's map controls.
  if (pageOption(p, 'model.option.displayMapControls') !== sidePanel) toggleSidePanel();
  renderSide();
}
/** Keep FreeCol's client options as the client Engine has them now: the turn report's buttons change some. */
function pullFreecolOptions() {
  if (!colonyClient) return;
  const engine = JSON.parse(colonyClient.clientOptionValues()) as Record<string, unknown>;
  const freecol = fromEngine(prefs, engine, freecolDefaults);
  if (JSON.stringify(freecol) !== JSON.stringify(prefs.freecol)) {
    prefs = { ...prefs, freecol };
    savePrefs(prefs);
  }
}
/** Whether the side panel is shown: the player's choice, kept for the next visit. */
const SIDE_PANEL_KEY = 'freecol.sidePanel';
let sidePanel = (() => {
  // FreeCol's display map controls option, once the player has set it, says.
  const option = prefs.freecol['model.option.displayMapControls'];
  if (typeof option === 'boolean') return option;
  try {
    return localStorage.getItem(SIDE_PANEL_KEY) !== 'hidden';
  } catch {
    return true;
  }
})();
document.body.dataset.sidePanel = sidePanel ? 'shown' : 'hidden';
/** Show or hide the side panel; the map takes the room it leaves. */
function toggleSidePanel() {
  sidePanel = !sidePanel;
  document.body.dataset.sidePanel = sidePanel ? 'shown' : 'hidden';
  try {
    localStorage.setItem(SIDE_PANEL_KEY, sidePanel ? 'shown' : 'hidden');
  } catch {
    // The choice just is not kept.
  }
  if (pageOption(prefs, 'model.option.displayMapControls') !== sidePanel) {
    prefs = { ...prefs, freecol: { ...prefs.freecol, 'model.option.displayMapControls': sidePanel } };
    savePrefs(prefs);
    colonyClient?.setClientOption('model.option.displayMapControls', String(sidePanel));
  }
  renderSide();
}
// Shift+F11 shows or hides it too.
addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'F11' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    toggleSidePanel();
  },
  { capture: true },
);
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
  modes: view.modes,
  // As FreeCol's display actions do, each switch is kept as its client option.
  toggleMode: (mode) => setPrefs({ ...prefs, freecol: { ...prefs.freecol, [MODE_OPTIONS[mode]]: !view.modes[mode] } }),
  setTileText: (text) => setPrefs({ ...prefs, freecol: { ...prefs.freecol, [MODE_OPTIONS.tileText]: text } }),
  fog: pageOption(prefs, 'model.option.displayFogOfWar'),
  toggleFog: () =>
    setPrefs({
      ...prefs,
      freecol: { ...prefs.freecol, [MODE_OPTIONS.fog]: !pageOption(prefs, 'model.option.displayFogOfWar') },
    }),
  sidePanel,
  toggleSidePanel,
  fullScreen: document.fullscreenElement !== null,
  toggleFullScreen: () => {
    // The browser may refuse (no gesture, or not allowed); the menu follows fullscreenchange.
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(
      () => {},
    );
  },
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
document.addEventListener('fullscreenchange', () => renderSide());
const sideRoot = createRoot(document.getElementById('side')!);
/** The layer of the windows over the page, outside the side panel. */
const overlays = document.getElementById('overlays')!;
function renderSide() {
  menuRoot.render(<MenuBar menus={currentMenus()} status={statusLine} />);
  sideRoot.render(
    <>
      <Side
        {...side}
        debug={
          debug
            ? { at: cursor(view)?.at ?? null, note: debugNote, request: debugRequest, skipTurns: debugSkip, resetSave }
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
      {/* The windows, popup and banner go in their own layer: hiding the side panel must not hide them. */}
      {createPortal(
        <>
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
              freecol={freecolOptions}
              change={setPrefs}
              close={() => {
                prefsOpen = false;
                renderSide();
              }}
            />
          )}
          <TurnBanner notice={shownNotice(banner, lastTurn, idleTurn)} />
          {popup && (
            <PopupMenu popup={popup} run={(id) => menuClient?.menuEntry(id)} close={() => showPopup(null)} art={art} />
          )}
        </>,
        overlays,
      )}
    </>,
  );
}

let view: ViewState = { ...initialView, modes: startModes(prefs) };
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
  if (status === 'failed') reportError('The game could not go on', describeError(extra.error));
  const state = { status, rules, preset, choice, nation, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  side.status = JSON.stringify(state, null, 1);
  renderSide();
}

/** The turn the preference last ended by itself, so a second no-unit event in it does not end it twice. */
let autoEnded: string | null = null;
window.fcUnasked = [];
const gui: GuiHandlers = {
  events: {
    activeUnit: (e) => {
      // The Engine says which orders the active unit can take now.
      side.orders = e.orders;
      side.route = e.route;
      dispatch({ k: 'activeUnit', ...e, jump: pageOption(prefs, 'model.option.jumpToActiveUnit') });
      idleTurn = e.unit === null && lastTurn?.ourTurn ? lastTurn.turn : null;
      renderSide();
      // No unit left to move: end the turn, once for each turn (FreeCol's auto end turn option).
      if (e.unit === null && prefs.autoEndTurn && lastTurn?.ourTurn && autoEnded !== lastTurn.turn) {
        autoEnded = lastTurn.turn;
        runCommand({ k: 'endTurn' });
      }
    },
    selectedTile: (e) => dispatch({ k: 'selectedTile', ...e, always: pageOption(prefs, 'model.option.alwaysCenter') }),
    focus: (e) => dispatch({ k: 'focus', ...e }),
    animateMove: (e) => map.moved(e),
    sound: (e) => playSound(e.key),
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
    messages: (raw) => {
      const e = { ...raw, messages: visibleMessages(prefs, raw.messages) };
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
    father: (q) => dialogQueue.ask('father', q),
    warehouse: (q) => dialogQueue.ask('warehouse', q),
  },
};

function drawMap(m: MapView) {
  nation = m.nation;
  side.turn = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  statusLine = m.statusLine;
  // A new turn's notice stays through the maps of its turn; the AI's goes when play comes back.
  banner = turnNotice(lastTurn, m) ?? (banner?.kind === 'new' && m.ourTurn ? banner : null);
  // FreeCol's disable end turn background option: no banner while the others move.
  if (banner?.kind === 'ai' && pageOption(prefs, 'model.option.disableGrayLayer')) banner = null;
  lastTurn = m;
  if (m.ourTurn) autosaveSoon();
  renderSide();
  dispatch({ k: 'map', map: m });
  pullColonies();
  drawn = map.draw(m);
  // A dialog shown before the art manifest loaded has no images: draw it again once they can be had.
  if (!artReady)
    void drawn.then(() => {
      if (!map.resources()) return;
      artReady = true;
      showCompass(pageOption(prefs, 'model.option.displayCompassRose'));
      renderSide();
    });
}

blockBrowserMenu(document);
/** The client Engine, once loaded: a held Go To asks it for the path and sends the unit. */
let gotoClient: ClientExports | null = null;
const gotoDeps = {
  preview: (tile: Tile | null) =>
    dispatch({
      k: 'preview',
      path: tile && gotoClient ? (JSON.parse(gotoClient.pathTo(...tile)) as PathStep[] | null) : null,
    }),
  go: (tile: Tile) => gotoClient?.goTo(...tile),
};
const dragged = pointerInput(mapHost, {
  view: () => view,
  dispatch,
  tileAt: (px, py) => map.tileAt(px, py),
  goto: gotoDeps,
  edgeScrolls: () => pageOption(prefs, 'model.option.autoScroll'),
  dragScrolls: () => pageOption(prefs, 'model.option.mapScrollOnDrag'),
});
gotoKeyInput(
  mapHost,
  (px, py) => map.tileAt(px, py),
  gotoDeps,
  () => gotoClient !== null && view.active !== null && !dialogQueue.current(),
);

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
    // Zoom is the browser's own: + and - step the map about its centre, as the View menu does.
    const zoom = e.key === '+' || e.key === '=' ? 1 : e.key === '-' ? -1 : 0;
    if (zoom) {
      e.preventDefault();
      menuActions().zoom(zoom);
      return;
    }
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
  // FreeCol's main panel plays the introduction music.
  playSound('sound.intro.general');
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

/** Delete the autosaves and reload on a new game: the page's own load and new parameters go. */
function resetSave() {
  autosaveSoon = () => {}; // no autosave of the game being thrown away
  const next = new URLSearchParams(location.search);
  next.delete('load');
  next.delete('new');
  store
    .list()
    .then((all) => Promise.all(all.filter(isAutosave).map((m) => store.remove(m.id))))
    .catch(console.warn)
    .finally(() => {
      location.search = next.toString();
    });
}

/** Wait for the player to stop changing things for this long before autosaving. */
const AUTOSAVE_MS = 1500;
/** Whether this page is a fresh start the autosave may replace: not a debug start, not a scripted run. */
const mayResume = !params.has('new') && !params.has('skipstart') && !params.has('preset') && autoplay === 0;

async function run() {
  if (loadId === undefined && mayResume && (import.meta.env.DEV || params.has('resume'))) {
    try {
      const auto = await latestAutosave(store);
      if (auto) {
        loadId = auto.id;
        skipStart = true;
        resumed = true;
      }
    } catch (ex) {
      console.warn('no autosave to resume:', ex);
    }
  }
  const data = (await (await fetch(dataUrl)).json()) as string[];
  const clientOptions = clientOptionsGroup(data);
  if (clientOptions) {
    freecolOptions = shownClientOptions(clientOptions);
    freecolDefaults = new Map([...leaves(clientOptions)].map(([id, o]) => [id, o.value]));
  }
  const chosen = skipStart ? '' : await chooseGame(data);
  choice = chosen;
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // An error the Worker does not catch, such as a trap in the server Engine, stops the game's server.
  worker.addEventListener('error', (e) => reportError('The game server hit an error', e.message || 'unknown error'));
  worker.addEventListener('messageerror', () =>
    reportError('The game server sent a message the page could not read', ''),
  );
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
      // A failure the game goes on after; one it does not ("failed", a load that fails) goes on the banner through show().
      const failure = engineError(name, detail);
      if (failure) reportError(failure.title, failure.detail);
      switch (name) {
        case 'gameStarted':
          // PreGameController.startGame: the default playlist plays whenever no other music does.
          void sound.then((s) => s?.startPlaylist());
          return drawMap(JSON.parse(detail) as MapView);
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
          if (isAutosave(meta)) {
            // One slot: the new autosave replaces the old ones, quietly.
            return void dropOlderAutosaves(store, meta).catch(console.warn).finally(listSaves);
          }
          side.saveNote = `Saved: ${meta.name}`;
          return listSaves();
        }
        case 'saveFailed':
          side.saveNote = `Save failed: ${detail}`;
          return renderSide();
        case 'loadFailed':
          if (resumed && loadId !== undefined) {
            // An autosave the Engine can no longer read (it changed under it): drop it and start afresh.
            console.warn('autosave would not load, starting afresh:', detail);
            return resetSave();
          }
          return show('failed', { error: detail });
        case 'debug':
          debugNote = describeAnswer(detail);
          return renderSide();
        case 'debugFailed':
          debugNote = `Failed: ${detail}`;
          return renderSide();
        case 'commandFailed':
          return; // on the banner, above
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
  // Autosave a moment after the player's last change, so a reload (a dev rebuild, say) loses nothing.
  const autosave = debounced(() => {
    if (!lastTurn?.ourTurn) return;
    worker.postMessage({ k: 'save', active: exports.activeUnitId(), name: AUTOSAVE_NAME } satisfies ToWorker);
  }, AUTOSAVE_MS);
  autosaveSoon = () => {
    if (autoplay === 0) autosave();
  };
  colonyNow = (id) => exports.colony(id);
  colonyClient = exports;
  pushFreecolOptions(prefs.freecol);
  debugRequest = (r) => worker.postMessage(debugMessage(r));
  debugSkip = (n) => {
    if (n > 0) exports.skipTurns(n);
  };
  reportButtons = {
    groupBy: (value) => {
      exports.reportGroupBy(value);
      pullFreecolOptions();
    },
    filter: (index, shown) => {
      exports.reportFilter(index, shown);
      pullFreecolOptions();
    },
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
    leave: (unit: string) => exports.leaveShip(unit),
    buy: (goods: string, ship: string, ask: boolean) => exports.buyGoods(ship, goods, ask),
    sell: (goods: string, ship: string, ask: boolean) => exports.sellGoods(ship, goods, ask),
    sail: (ship: string) => exports.sailToNewWorld(ship),
  });
  playWith(exports);
}

listSaves();
show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
