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
//   ?debug       the debug menu (or Ctrl+Shift+D in the game): reveal the map, add gold, units and goods, skip turns, show the AI's view
//   ?skipstart   no start screen: start a game with FreeCol's defaults (debug; the browser scripts use it)
//   ?preset=NAME start straight away from presets/NAME.json (or a URL ending .json): a
//                preset sets the nation, difficulty, options and map seed (debug)
//   ?tileset=ID  a Tileset built beside the default, art/<ID>.json (e.g. test)
//   ?renderer=canvas2d  draw with the Canvas 2D fallback, not PixiJS (debug)
//   ?theme=dark  the dark palette of theme.css, whatever the player picked in Preferences
//   ?fps         a frame-rate meter over the map (debug; also Debug > Show Frame Rate)
import clientUrl from '../generated/client.wasm?url';
import dataUrl from '../generated/data.json?url';
import runtimeUrl from '../generated/teavm-runtime.js?url';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import './theme.css';
import './fonts.css';
import './tokens.css';
import { colopediaBefore, snapshotter, startPage, type ClientExports, type Scope, type ToWorker } from './channel';
import {
  chosenRequest,
  DebugContext,
  debugEntryRequest,
  NO_DISPLAY,
  debugMessage,
  debugMode,
  describeAnswer,
  parseSearch,
  overlayRequest,
  type DebugClientRequest,
  type DebugDisplay,
  type DebugPlayer,
  type DebugRequest,
  type OverlayAnswer,
} from './debug';
import { afterSlide as slideGate, viewHold } from './after-slide';
import { ColonyActions, ColonyTiles, type ColonyMoves, type DrawTiles } from './colony-panel';
import { dialogs } from './dialogs';
import { blockBrowserKeys, steppedScale } from './browser-keys';
import { BUILD } from './build';
import { keepTabOnPage } from './focus';
import { leaveGuard } from './leave-guard';
import { TipProvider, TooltipLayer } from './controls';
import { MENUS, MenuBar, framePlaces, goodsIcons, type Menu } from './frame';
import { CreditsDialog } from './credits';
import { captureConsole } from './log-buffer';
import { CopyDetailsContext, LogDialog, ShowLogContext, joinLogs } from './log';
import { copyText, errorDetails } from './error-details';
import { fpsMeter } from './fps-meter';
import { debugMenu, gameMenu, ordersMenu, reportOptionsMenu, viewMenu, type MenuActions } from './menus';
import { commandForKey, type Command } from './input';
import { PreferencesDialog } from './prefs-dialog';
import { setCurrentSaveSource } from './current-save';
import { feedbackOpen, openFeedback, setFeedbackSources, startFeedback } from './feedback-host';
import { OpenDialog, SaveDialog } from './save-picker';
import {
  blinkMs,
  fromEngine,
  loadPrefs,
  minimapOptions,
  moveMs,
  pageOption,
  savePrefs,
  shownClientOptions,
  startModes,
  MODE_OPTIONS,
  visibleMessages,
  fontScale,
  terrainAnimation,
  tilesetManifest,
  uiZoom,
  volumes,
  autosaveOptions,
  type FreeColValue,
  type Prefs,
} from './prefs';
import { LANGUAGE_OPTION, languageName, languages, pickLanguage, translationFiles } from './language';
import { clientOptionsGroup, leaves, type OptionGroup } from './options';
import { mapDrawer, type MapView } from './map';
import { europeButtons, showEurope } from './europe-client';
import { DialogHost, type Art, type ReportButtons, type RouteButtons } from './panels';
import { acceleratorFor, inTextField, type Accelerator } from './accelerators';
import { isTurnReportKey, reportForKey } from './report-keys';
import { ReportContext, colopediaMenu, reportMenu, type ReportActions } from './reports';
import { NO_OVERLAY, type ColonyLabels, type PathStep } from './tileset';
import {
  blockBrowserMenu,
  blockImageDrag,
  gotoKeyInput,
  onCanvas,
  pointerInput,
  rightClickInput,
  type GotoDeps,
} from './pointer';
import { ContextMenuContext, PopupMenu, parseMenu, type ContextMenus, type MenuData, type Popup } from './popup-menu';
import type { AudioManifest } from './resources';
import { soundPlayer } from './sound';
import { StartScreen, type StartSetup } from './start-screen';
import { presetJson, startOptions } from './start';
import { nationName } from './fsg';
import {
  chooseOpenFile,
  chooseSaveFile,
  exportSaveFile,
  fileNameOf,
  hasSavePicker,
  importSave,
  nameFromFile,
  type SaveTarget,
} from './save-files';
import { LoadingSaveDialog, showsLoadingSave } from './loading-save';
import {
  AUTOSAVE_NAME,
  debounced,
  dropOlderAutosaves,
  dropOutdatedAutosaves,
  dropTurnAutosaves,
  idbSaveStore,
  isAutosave,
  isTurnAutosave,
  keepSaves,
  lastTurnSaveName,
  latestAutosave,
  missingSaveNote,
  resumeSearch,
  saveFailedTitle,
  shiftLastTurnSaves,
  turnAutosaveNames,
  type SaveMeta,
} from './saves';
import { advisor } from './advisor';
import { InfoPanel } from './info-panel';
import { MinimapPanel } from './minimap-panel';
import { MapOrders } from './map-orders';
import { Side, type SideProps } from './side';
import { ReloadNotice, reloadPending } from './reload-notice';
import { isIdle, type Mover, MoverHold, TurnBanner, turnNotice, type TurnFacts, type TurnNotice } from './turn-banner';
import { tabTitle } from './tab-title';
import { ErrorBanner, addError, engineError, type GameError } from './errors';
import { loading, type PartName } from './loading';
import { mobileNotice } from './mobile-notice';
import { loadModule } from './teavm';
import { applyTheme } from './theme';
import { syncThemeColor } from './install';
import { controlArt } from './control-art';
import { cursor, initialView, panel, reduce, tileOnScreen, W, type ViewEvent, type ViewState } from './view';
import type { GuiEvents, GuiHandlers, PopupEvent, ReportView } from './webgui';

declare global {
  interface Window {
    fcResult?: Record<string, unknown>;
    /** For scripts/rounds.ts: the AI rounds so far, each as "round,milliseconds". */
    fcRounds?: string[];
    /** For scripts/play.ts: resolves once the unit that moved has slid and the view has caught up with the Engine. */
    fcSettled?: () => Promise<void>;
    /** For scripts/play.ts: pan a tile into view if needed; its centre on the map canvas. */
    fcReveal?: (x: number, y: number) => [number, number];
    /** For scripts/play.ts: the view state, without its map, the cursor, and its tile's centre in the viewport. */
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

/** What the page's console was given, for the log (log.tsx); the Worker keeps its own. */
const pageLog = captureConsole(console);
/** The log window's text, or null while it is closed. */
let logText: string | null = null;
/** Ask the Worker for its log, which comes back as a "log" event; with no Worker yet, the page's alone. */
let askWorkerLog: () => void = () => showWorkerLog('');
/** Who waits for the Worker's log without wanting the log window (the error panel's Copy details). */
let workerLogWaiters: ((text: string) => void)[] = [];
/** The Worker's log as text: nothing when there is no Worker, or when it does not answer in a second. */
function fetchWorkerLog(): Promise<string> {
  return new Promise((resolve) => {
    // The start screen has no Worker to ask.
    if (!askWorkerLogQuietly) return resolve('');
    const waiter = (text: string) => {
      clearTimeout(timer);
      resolve(text);
    };
    const timer = setTimeout(() => {
      workerLogWaiters = workerLogWaiters.filter((w) => w !== waiter);
      resolve('');
    }, 1000);
    workerLogWaiters.push(waiter);
    askWorkerLogQuietly?.();
  });
}
let askWorkerLogQuietly: (() => void) | null = null;
/** The error panel's Copy details: what errorDetails lists, with the Engines' logs as they are now. */
async function copyErrorDetails(e: GuiEvents['error']) {
  const server = await fetchWorkerLog();
  return copyText(
    errorDetails(e, {
      build: BUILD,
      userAgent: navigator.userAgent,
      log: { server, client: pageLog.text() },
    }),
  );
}
function showWorkerLog(workerText: string) {
  // A log asked for by Copy details is for the copy, not for the window.
  if (workerLogWaiters.length > 0) {
    const waiters = workerLogWaiters;
    workerLogWaiters = [];
    for (const w of waiters) w(workerText);
    return;
  }
  logText = joinLogs(workerText, pageLog.text());
  renderSide();
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
      showLog={() => askWorkerLog()}
      report={() => openFeedback('bug')}
      dismiss={() => {
        errors = [];
        renderErrors();
      }}
    />,
  );
}
/** Show an error on the banner, so a game that breaks does not break silently. */
function reportError(title: string, detail: string) {
  // scripts/common.ts collects the errors by this prefix.
  console.error(`Error banner: ${title}\n${detail}`);
  errors = addError(errors, title, detail);
  window.fcErrors = addError(window.fcErrors ?? [], title, detail);
  renderErrors();
}
// The Send feedback window attaches the banner's errors and both Engines' logs; the Beta tag opens it.
setFeedbackSources({
  errors: () => errors,
  logs: async () => joinLogs(await fetchWorkerLog(), pageLog.text()),
});
startFeedback();
const describeError = (ex: unknown) => (ex instanceof Error ? (ex.stack ?? ex.message) : String(ex));
// The page's own errors, which would otherwise show only in the console.
addEventListener('error', (e) => reportError('The page hit an error', describeError(e.error ?? e.message)));
addEventListener('unhandledrejection', (e) => reportError('The page hit an error', describeError(e.reason)));

const params = new URLSearchParams(location.search);
const autoplay = Number(params.get('autoplay') ?? '0');
/** The ruleset: the start screen may switch it in place, before a game begins. */
let rules = params.get('rules') ?? 'classic';
/** The setup made on the start screen (nation, level, options, open tab), kept across a ruleset switch. */
let startSetup: StartSetup | undefined;
let loadId = params.has('load') ? Number(params.get('load')) : undefined;
/** The page picked up the autosave by itself, so a load that fails drops it rather than leave the page stuck. */
let resumed = false;
const preset = params.get('preset');
/** No start screen: a debug start, a loaded game, or ?skipstart. */
let skipStart = params.has('skipstart') || params.has('preset') || loadId !== undefined;
/** Debug mode: `?debug`, or switched on and off with Ctrl+Shift+D or the View menu (FreeCol's Debug action). */
let debug = debugMode(params);
/** A Tileset named in the URL (scripts use ?tileset=test), over the player's own; links within the page keep it. */
const tileset = params.get('tileset');
/** A palette named in the URL, over the player's own. */
const urlPalette = params.get('theme');
const mapHost = document.getElementById('map')!;
/** The map's size: its host's box, which the page's CSS gives what the side panel leaves. */
const mapSize = (): [number, number] => [mapHost.clientWidth, mapHost.clientHeight];
/** The preferences as the page loads: some are read only then. */
const prefsAtLoad = loadPrefs();
/** The loading screen of index.html, up from the first paint: the bar follows the parts the page waits for. */
const boot = loading();
// A phone is told the game is not made for it yet (#319).
mobileNotice();
const map = mapDrawer(
  mapHost,
  mapSize(),
  'art/',
  tileset ? `${tileset}.json` : tilesetManifest(prefsAtLoad.tileset),
  // FreeCol's Enable OpenGL option off draws with Canvas 2D, as ?renderer=canvas2d does.
  params.get('renderer') === 'canvas2d' || !pageOption(prefsAtLoad, 'model.option.useOpenGL'),
  pageOption(prefsAtLoad, 'model.option.graphicsQuality'),
  () => boot.finish('art'),
);
/** The frame-rate meter over the map's top-left corner: ?fps, or Debug > Show Frame Rate. */
const fps = fpsMeter(document.getElementById('game')!, () => map.renderer());
fps.show(params.has('fps'));
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
/** The last request made, for the one that asks which owner, role and so on (chosenRequest). */
let lastDebug: DebugRequest | null = null;
let debugSkip: (n: number) => void = () => {};
/** The client Engine's own debug tools (DebugClientTools), once it has loaded; a bad request throws. */
let debugClient: (r: DebugClientRequest) => string = () => '{}';
/** The European players the Debug menu offers (the Engine's `players` answer), once the game has started. */
let debugPlayers: DebugPlayer[] = [];
/** What the Debug menu has the map show: coordinates, colony values, AI missions, the AI's defence map. */
let debugDisplay: DebugDisplay = NO_DISPLAY;
/** Change what the map shows for the Debug menu, and ask the Engine for the text and tints it needs. */
function setDebugDisplay(change: Partial<DebugDisplay>) {
  const before = debugDisplay.colonyValue;
  debugDisplay = { ...debugDisplay, ...change };
  // The tile panel's colony-value breakdown follows the player the menu picked (FreeColDebugger).
  if (debugDisplay.colonyValue !== before) menuClient?.showColonyValue(debugDisplay.colonyValue ?? '');
  const r = overlayRequest(debugDisplay);
  if (r) debugRequest(r);
  else dispatch({ k: 'overlay', overlay: NO_OVERLAY });
  renderSide();
}
/** The overlay asked for again: the AI's missions, the values and its defence move with the turns. */
const refreshOverlay = () => {
  const r = overlayRequest(debugDisplay);
  if (r && (debugDisplay.missions || debugDisplay.colonyValue !== null || debugDisplay.defence !== null))
    debugRequest(r);
};
/** Debug mode's Step Random number generator: each number is shown, and the player may step again (DebugUtils.stepRNG). */
function stepRNG(value?: number) {
  if (
    value === undefined ||
    window.confirm(`Step Random Number Generator (${value})\n\nOK steps again, Cancel stops.`)
  ) {
    debugRequest({ action: 'stepRNG' });
  }
}
/** Compare the client Engine's map with the server Engine's (DebugUtils.checkDesyncAction). */
function compareMaps() {
  debugRequest({ action: 'compareMaps', client: JSON.parse(debugClient({ action: 'digest' })) as unknown });
}
/** Show the resource keys of the images the game has, as ResourceManager.summarizeImageResources lists them. */
function showResourceKeys() {
  const keys = map.resources()?.imageKeys() ?? [];
  dialogQueue.show('information', {
    text: `All keys\n${keys.join(' ')}`,
    object: null,
    images: [],
    ok: 'OK',
    tile: null,
    at: null,
  });
}
const store = idbSaveStore();
/** Show the saves in the list; no storage (a private window, say) is an empty list. */
function listSaves() {
  store
    .list()
    .then((saves) => (side.saves = saves))
    .catch((ex: unknown) => (side.saveNote = `Saves unavailable: ${String(ex)}`))
    .finally(renderSide);
}
/**
 * Open a .fsg file the player picks: it joins the saves in the store, and the game in it is played. Resolves to
 * why it would not open; empty when it opens, or the player cancels.
 */
async function openSaveFile(): Promise<string> {
  try {
    const file = await chooseOpenFile();
    if (!file) return '';
    const meta = await importSave(store, file.name, new Uint8Array(await file.arrayBuffer()), Date.now());
    openSave(meta.id);
    return '';
  } catch (ex) {
    return `Could not open the file: ${ex instanceof Error ? ex.message : String(ex)}`;
  }
}
let saveGame: (name: string) => void = () => {};
/** Schedule an autosave (set once the client Engine has loaded). */
let autosaveSoon: () => void = () => {};
/** Saves asked for by name before the client Engine has loaded, made once it has. */
const waitingSaves: string[] = [];
/** Make a save with this name, quietly (set once the client Engine has loaded). */
let saveNamed: (name: string) => void = (name) => void waitingSaves.push(name);
/** The turn whose autosaves have been asked for, null before the first of the player's turns. */
let autosavedTurn: number | null = null;
/**
 * FreeCol's autosaves as the player's turn begins (InGameController.autoSaveGame): the last-turn
 * save, and a turn autosave every so many turns. Not for a loaded game's first turn, as FreeCol's
 * newly loaded game makes none, nor for a scripted run's.
 */
function turnAutosave(m: MapView) {
  if (!m.ourTurn || autoplay > 0) return;
  const turn = Number(m.turn);
  if (autosavedTurn === turn) return;
  const first = autosavedTurn === null;
  autosavedTurn = turn;
  if ((first && loadId !== undefined) || !(turn > 0)) return;
  for (const name of turnAutosaveNames(autosaveOptions(prefs), turn, m.turnLabel)) saveNamed(name);
}
/** The turn report's buttons, once the client Engine has loaded. */
let reportButtons: ReportButtons = { groupBy: () => {}, filter: () => {}, ignore: () => {}, open: () => {} };
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
/**
 * What tells the client Engine that a pop-up is closed (#433): its Go To orders wait for it. Later than the
 * Engine's call that showed it, as the Engine is not called back from within its own call.
 */
const popupClosed = (e: PopupEvent) => (): void => {
  const id = e.popup;
  if (id == null) return;
  queueMicrotask(() => popupClient?.popupClosed(id));
};
/** The client Engine's popupClosed, once it has loaded. */
let popupClient: Pick<ClientExports, 'popupClosed'> | null = null;
const colonyMoves: ColonyMoves = {
  work: (unit, location) => colonyClient?.work(unit, location),
  putOutside: (unit) => colonyClient?.putOutsideColony(unit),
  changeWork: (unit, goods) => colonyClient?.changeWorkType(unit, goods),
  setQueue: (colony, types) => colonyClient?.setBuildQueue(colony, types.join(',')),
  buy: (colony) => colonyClient?.payForBuilding(colony),
  warehouse: (colony) => colonyClient?.warehouse(colony),
  units: (colony) => {
    const menu = colonyClient ? parseMenu(colonyClient.colonyUnitsMenu(colony)) : null;
    if (menu) showPopup({ menu, ...colonyOrigin() });
  },
  step: (colony, by) => colonyClient?.stepColony(colony, by),
  close: (colony) =>
    colonyClient ? colonyClient.closeColonyPanel(colony) : dialogQueue.remove('colony', (open) => open.id === colony),
  board: (unit, ship) => colonyClient?.boardShip(unit, ship),
  leaveShip: (unit) => colonyClient?.leaveShip(unit),
  equip: (unit, goods) => colonyClient?.equipUnit(unit, goods),
  load: (ship, goods, ask) => colonyClient?.loadGoods(ship, goods, ask),
  unload: (ship, goods, stack, ask) => colonyClient?.unloadGoods(ship, goods, stack, ask),
  unloadAll: (ship) => colonyClient?.menuEntry(`unloadAll:${ship}`),
  fill: (ship) => colonyClient?.menuEntry(`fill:${ship}`),
  transfer: (from, to, goods, stack) => colonyClient?.transferGoods(from, to, goods, stack),
};
/** Where the colony panel's own menus open (ColonyPanel shows them at 0, 0): the top left of the open colony. */
function colonyOrigin(): { x: number; y: number } {
  const colonies = document.querySelectorAll('.dialog[data-kind="colony"]');
  const r = colonies[colonies.length - 1]?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0 };
}
/** FreeCol's status line: the score, the gold, the tax and the year. */
let statusLine = '';
/** The turn the last map was of, and the banner over the map about it (turn-banner.tsx). */
let lastTurn: TurnFacts | null = null;
let banner: TurnNotice | null = null;
/** The player the Engine says is moving, held on the banner long enough to read (MoverHold). */
let mover: Mover | null = null;
const moverHold = new MoverHold((m) => {
  mover = m;
  // The banner of the AI moving takes the name; nothing changes while it is our turn or the banner is hidden.
  if (lastTurn && !lastTurn.ourTurn) showMoverBanner();
});
/** The banner of the AI moving, naming whoever moves now. */
function showMoverBanner() {
  if (!lastTurn || lastTurn.ourTurn) return;
  banner = pageOption(prefs, 'model.option.disableGrayLayer') ? null : turnNotice(null, lastTurn, mover);
  renderSide();
}
/** The map the Engine last said no unit is left to move after, undefined while one is active (isIdle in turn-banner.tsx). */
let noUnitHeard: TurnFacts | null | undefined;
/** What the links in a report do, once the client Engine has loaded. */
const reportActions: ReportActions = {
  open: (name) => colonyClient?.report(name),
  detail: (name, id) => colonyClient?.reportDetail(name, id),
  colony: (id) => colonyClient?.showColony(id),
  europe: () => runCommand({ k: 'showEurope' }),
  colopedia: (id) => menuClient?.menuEntry(`colopedia:${id}`),
  difficulty: () => runCommand({ k: 'showDifficulty' }),
  goTo: (at) => dispatch({ k: 'focus', tile: null, at }),
};
/** The player's preferences, and whether their window is open. */
let prefs: Prefs = prefsAtLoad;
let prefsOpen = false;
/** The save dialog, if open: Game > Save, or Game > Save and Exit, which goes back to the start screen once saved. */
let saveDialog: 'save' | 'saveAndExit' | null = null;
/** Whether the Open window (a save picker) is open. */
let openOpen = false;
/** The page is waiting for a save to finish before it goes back to the main title. */
let exitAfterSave = false;
/** The file the player picked for the save being made, and the name it is saved under, to write once made (#274). */
let saveFile: { target: SaveTarget; name: string } | null = null;
/** A failed save is on the error banner; the next failure stays off it until a save works. */
let saveFailShown = false;
/** The save picker is open: another Save waits for it, as the browser shows one picker at a time. */
let picking = false;
/** Why the last file picked in the Open window would not open; empty for none. */
let openNote = '';
/**
 * Game > Save and Game > Save and Exit. Where the browser can write a file the player picks (save-files.ts),
 * FreeCol's file chooser: the save picker, then the game saved under the file's name and written to it. Elsewhere
 * the name dialog, and the save stays in the browser's store.
 */
/** The file name a save is offered under: the name given, or the nation and the turn. */
function suggestedFileName(name = ''): string {
  const m = lastMap;
  return fileNameOf(name.trim() || (m ? `${nationName(m.nation)}, ${m.turnLabel}` : ''));
}
function askToSave(then: 'save' | 'saveAndExit') {
  if (!hasSavePicker()) {
    saveDialog = then;
    return renderSide();
  }
  if (picking) return;
  picking = true;
  chooseSaveFile(suggestedFileName())
    .finally(() => (picking = false))
    .then((target) => {
      if (!target) return;
      const name = nameFromFile(target.name).trim();
      saveFile = { target, name };
      exitAfterSave = then === 'saveAndExit';
      saveGame(name);
    })
    .catch((ex: unknown) => {
      side.saveNote = `Save failed: ${String(ex)}`;
      renderSide();
      reportError('The game could not be saved to a file', String(ex));
    });
}
/** FreeCol's isPanelShowing: a window is open over the map. */
const panelShowing = () =>
  dialogQueue.current() !== null ||
  prefsOpen ||
  creditsOpen ||
  logText !== null ||
  openOpen ||
  saveDialog !== null ||
  feedbackOpen();
/** Whether a window was open at the last render, to see it close (renderSide). */
let windowWasOpen = false;
/** Asks before the page is left with play since the last save (leave-guard.ts). */
const leaveAsk = leaveGuard(window);
/** Reload the page with another query on purpose: the leave-page question is not asked (it is for Ctrl+W and F5). */
function leavePage(search: string) {
  leaveAsk.leaving();
  location.search = search;
}
/** FreeCol's mainTitle: a new page shows the start screen, which offers to continue the last save. */
function returnToMain() {
  autosaveSoon = () => {}; // the game is left as it is; the save the player made stays
  const next = new URLSearchParams();
  // The dev server resumes the autosave by itself; asking for ?new shows the start screen.
  next.set('new', '');
  if (tileset) next.set('tileset', tileset);
  leavePage(next.toString());
}
/** Open a saved game: a new page, with a new client Engine, is the cleanest way to a loaded game. */
function openSave(id: number) {
  const next = new URLSearchParams({ load: String(id) });
  if (tileset) next.set('tileset', tileset);
  leavePage(next.toString());
}
/** Whether the credits window (credits.tsx) is open. */
let creditsOpen = false;
/** FreeCol's music and sound effects, served under audio/ (build-audio.ts); null if the manifest is missing. */
let followVisibility = () => {};
const sound = fetch('audio/audio.json')
  .then((res) => (res.ok ? (res.json() as Promise<AudioManifest>) : Promise.reject(new Error(`${res.status}`))))
  .then((manifest) => {
    const player = soundPlayer(manifest, { base: 'audio/' });
    player.setVolumes(volumes(prefs));
    // A hidden tab or a minimised app is quiet, and goes on from where it was on return (#272).
    // Unless the player chose to keep it playing in the background.
    followVisibility = () => player.setHidden(document.visibilityState === 'hidden' && !prefs.playHidden);
    document.addEventListener('visibilitychange', followVisibility);
    followVisibility();
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
    // Beside the map, not in it, so the map's canvas does not cover it nor its click reach the map (#245).
    document.getElementById('game')!.append(compass);
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
/** The preferences the page's look follows: the theme, motion, dimming, and FreeCol's display scaling and font size. */
function applyLook(p: Prefs) {
  applyTheme(document.documentElement, p.palette, p.fonts, urlPalette);
  syncThemeColor();
  map.setMotion(moveMs(p), blinkMs(p), p.activeStyle);
  map.setTerrainAnimation(terrainAnimation(p));
  document.body.dataset.dimUnfocused = p.dimUnfocused;
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
  followVisibility();
  const changed = Object.fromEntries(Object.entries(p.freecol).filter(([id, v]) => was.freecol[id] !== v));
  // An option no longer set (Reset, Revert to Defaults) goes back to FreeCol's default.
  for (const id of Object.keys(was.freecol)) {
    if (!(id in p.freecol) && freecolDefaults.has(id)) changed[id] = freecolDefaults.get(id) as FreeColValue;
  }
  pushFreecolOptions(changed);
  // The Engine's map says whether the fog of war shows.
  if (MODE_OPTIONS.fog in changed) colonyClient?.refreshMap();
  // The View menu's modes follow their options.
  const modes = startModes(p);
  for (const mode of ['grid', 'borders'] as const) {
    if (view.modes[mode] !== modes[mode]) dispatch({ k: 'toggle', mode });
  }
  if (view.modes.tileText !== modes.tileText) dispatch({ k: 'tileText', text: modes.tileText });
  // The minimap and the info panel are FreeCol's map controls.
  applyMapControls(p);
  renderSide();
  renderMinimap();
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
/** A release build (build.sh -Prelease, Vite's release mode) starts with the debug side panel hidden. */
const SIDE_PANEL_AT_FIRST = import.meta.env.MODE !== 'release';
let sidePanel = (() => {
  try {
    const kept = localStorage.getItem(SIDE_PANEL_KEY);
    return kept === null ? SIDE_PANEL_AT_FIRST : kept !== 'hidden';
  } catch {
    return SIDE_PANEL_AT_FIRST;
  }
})();
document.body.dataset.sidePanel = sidePanel ? 'shown' : 'hidden';
/** Show or hide the debug side panel (only it); the map takes the room it leaves. */
function toggleSidePanel() {
  sidePanel = !sidePanel;
  document.body.dataset.sidePanel = sidePanel ? 'shown' : 'hidden';
  try {
    localStorage.setItem(SIDE_PANEL_KEY, sidePanel ? 'shown' : 'hidden');
  } catch {
    // The choice just is not kept.
  }
  renderSide();
}
// Shift+F11 shows or hides it.
addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'F11' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    toggleSidePanel();
  },
  { capture: true },
);
// Alt+Enter (FreeCol's windowed mode accelerator) and F11 switch full screen, as the View menu does.
addEventListener(
  'keydown',
  (e) => {
    if (acceleratorFor(e) !== 'fullScreen' || e.repeat) return;
    e.preventDefault();
    menuActions().toggleFullScreen();
  },
  { capture: true },
);
/** Whether FreeCol's map controls (the minimap and the info panel) show: its display map controls option. */
let mapControls = pageOption(prefs, 'model.option.displayMapControls');
document.body.dataset.mapControls = mapControls ? 'shown' : 'hidden';
/** Follow the option: the page shows or hides the map controls. */
function applyMapControls(p: Prefs) {
  mapControls = pageOption(p, 'model.option.displayMapControls');
  document.body.dataset.mapControls = mapControls ? 'shown' : 'hidden';
}
/** FreeCol's MapControlsAction: show or hide the map controls, and keep the option, as the Preferences window does. */
function toggleMapControls() {
  setPrefs({ ...prefs, freecol: { ...prefs.freecol, 'model.option.displayMapControls': !mapControls } });
}
// Ctrl+M, FreeCol's accelerator for it.
addEventListener(
  'keydown',
  (e) => {
    if (e.code !== 'KeyM' || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.repeat) return;
    e.preventDefault();
    toggleMapControls();
  },
  { capture: true },
);
/** Switch debug mode; the page's address keeps it, so a reload stays as it is. */
function toggleDebug() {
  debug = !debug;
  const next = new URLSearchParams(location.search);
  if (debug) next.set('debug', '1');
  else next.delete('debug');
  const q = next.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  // The overlays are the Debug menu's: with it gone they go too.
  if (!debug && debugDisplay !== NO_DISPLAY) setDebugDisplay(NO_DISPLAY);
  else if (debug && lastMap) debugRequest({ action: 'players' });
  renderSide();
}
// Ctrl+Shift+D, as FreeCol's DebugAction.
addEventListener(
  'keydown',
  (e) => {
    if (e.key.toLowerCase() !== 'd' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    toggleDebug();
  },
  { capture: true },
);
// Ctrl+Alt+C, as the Debug menu's Check for Map Desynchronization has it, in debug mode.
addEventListener(
  'keydown',
  (e) => {
    if (!debug || !menuReady || e.code !== 'KeyC' || !e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    e.preventDefault();
    compareMaps();
  },
  { capture: true },
);
/** Whether the client Engine has loaded, so the menus' game commands work. */
let menuReady = false;
/** DeclareIndependenceAction: the player is colonial, so not a rebel, independent or retired, and it is their turn. */
const canDeclare = () => !lastMap || (lastMap.colonial && lastMap.ourTurn);
/** EuropeAction: the player has a Europe, which independence removes. */
const hasEurope = () => !lastMap || lastMap.europe;
/** What the Game, Orders and View menus do (menus.ts). */
const menuActions = (): MenuActions => ({
  ready: menuReady,
  orders: side.orders,
  hasActiveUnit: view.active !== null,
  canDeclare: canDeclare(),
  hasEurope: hasEurope(),
  run: (c) => runCommand(c),
  newGame: () =>
    void confirmStopGame().then((go) => {
      if (!go) return;
      // A new page shows the start screen again; ?new stops the dev server resuming the autosave.
      const next = new URLSearchParams();
      next.set('new', '');
      if (tileset) next.set('tileset', tileset);
      leavePage(next.toString());
    }),
  // FreeCol's SaveAction asks for the file (askToSave), and is disabled while a panel is showing.
  save: () => askToSave('save'),
  saveAndExit: () => askToSave('saveAndExit'),
  returnToMain: returnToMain,
  panelShowing: panelShowing(),
  // OpenAction asks confirmStopGame before the save picker.
  open: () =>
    void confirmStopGame().then((go) => {
      if (!go) return;
      openOpen = true;
      openNote = '';
      renderSide();
    }),
  feedback: () => openFeedback('bug'),
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
  mapControls,
  toggleMapControls,
  debug,
  toggleDebug,
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
    Debug: debugMenu({
      ready: menuReady,
      at: cursor(view)?.at ?? null,
      ask: (question, fallback, then) => {
        const answer = window.prompt(question, fallback);
        if (answer) then(answer.trim());
      },
      request: debugRequest,
      skipTurns: debugSkip,
      toggleDebug,
      players: debugPlayers,
      display: debugDisplay,
      setDisplay: setDebugDisplay,
      fps: fps.shown(),
      toggleFps: () => {
        fps.show(!fps.shown());
        renderSide();
      },
      stepRNG: () => stepRNG(),
      compareMaps,
      client: (action) => {
        try {
          debugClient({ action });
        } catch (ex) {
          debugNote = `Failed: ${ex instanceof Error ? ex.message : String(ex)}`;
          renderSide();
        }
      },
      showResourceKeys,
    }),
    Report: [
      ...reportMenu(reportActions.open, menuReady ? () => runCommand({ k: 'showTurnReport' }) : null),
      ...reportOptionsMenu(a),
    ],
    Colopedia: [
      ...colopediaMenu(reportActions.open),
      {
        label: 'About BrowserCol',
        run: () => {
          creditsOpen = true;
          renderSide();
        },
      },
    ],
  };
  // The Debug menu, in debug mode only, comes before Report.
  const names = debug ? [...MENUS.slice(0, 3), 'Debug', ...MENUS.slice(3)] : MENUS;
  return names.map((name) => ({ name, items: items[name] ?? [] }));
};
const menuRoot = createRoot(document.getElementById('menubar')!);
// Tab goes round the page's buttons rather than out to the browser's address bar.
keepTabOnPage();
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
    if (open.readOnly || json === 'null' || json === JSON.stringify(open)) continue;
    dialogQueue.replace('colony', JSON.parse(json) as GuiEvents['colony'], (c) => c.id === open.id, true);
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
/** The tile popup's debug entries (TilePopup.addDebugItems), those the Engine can do, in debug mode. */
function debugTileEntries(menu: MenuData | null, tile: readonly [number, number]): MenuData | null {
  if (!debug || !menuClient) return menu;
  const extra = parseMenu(menuClient.debugTileMenu(...tile));
  if (!extra) return menu;
  // The first entry has a line above it, which a menu with nothing before it has no use for.
  const entries = menu ? extra.entries : extra.entries.map((e, i) => (i === 0 ? { ...e, gap: false } : e));
  return { title: menu?.title ?? extra.title, entries: [...(menu?.entries ?? []), ...entries] };
}
/** Run a menu entry: a debug one asks the server Engine, any other the client Engine. */
function runMenuEntry(id: string) {
  // The argument may hold colons itself (a unit id is `unit:123`).
  const [prefix, action, ...rest] = id.split(':');
  const arg = rest.join(':');
  // The colony units menu's entry opens that unit's quick action menu, where the units menu was (ColonyPanel).
  if (prefix === 'unitMenu') {
    const menu = contextMenus.unit(id.slice('unitMenu:'.length));
    if (menu) showPopup({ menu, ...colonyOrigin() });
    return;
  }
  if (prefix !== 'debug') {
    menuClient?.menuEntry(id);
    return;
  }
  if (action === 'addGoods') {
    const type = window.prompt('Goods type', 'model.goods.food');
    const amount = type ? Math.trunc(Number(window.prompt('Amount to add', '100'))) : NaN;
    if (type && Number.isFinite(amount)) debugRequest({ action: 'addGoods', type, amount, unit: arg });
    return;
  }
  if (action === 'showSearch') {
    // TilePopup's "Show search": what the active unit's path search to the tile did.
    const [x, y] = arg.split(',').map(Number);
    const search = parseSearch(menuClient?.debugSearch(x, y) ?? '');
    debugNote = search?.log || 'No search (no active unit, or it is there)';
    // SwingGUI.setUnitPath: the map draws the path until the active unit changes.
    if (search) dispatch({ k: 'preview', path: search.path });
    renderSide();
    return;
  }
  const request = debugEntryRequest(action, arg);
  if (request) debugRequest(request);
}
const contextMenus: ContextMenus = {
  unit: (id) => {
    const menu = menuClient ? parseMenu(menuClient.unitMenu(id)) : null;
    // DebugUtils.addGoodsAdditionEntry: in debug mode a unit's menu can add goods to it.
    if (menu && debug) menu.entries.push({ id: `debug:addGoods:${id}`, label: 'Add goods', enabled: true, gap: true });
    return menu;
  },
  colonyTile: (x, y) => (menuClient ? parseMenu(menuClient.colonyTileMenu(x, y)) : null),
  goods: (location, type, amount) => (menuClient ? parseMenu(menuClient.goodsMenu(location, type, amount)) : null),
  show: (menu, x, y) => showPopup({ menu, x, y }),
};
/**
 * In full screen, Escape closes the menu or window on top, as it does in a window, rather than leaving full
 * screen: where the browser has the Keyboard Lock API (Chromium), the page takes Escape and the player holds it
 * to leave. Elsewhere (Firefox, Safari) the browser keeps Escape, and it leaves full screen too.
 */
const keyboardLock = (navigator as { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } })
  .keyboard;
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) void keyboardLock?.lock?.(['Escape']).catch(() => {});
  else keyboardLock?.unlock?.();
  renderSide();
});
// The menus' Save entries depend on whether a window is open.
dialogQueue.subscribe(() => renderSide());
const sideRoot = createRoot(document.getElementById('side')!);
/**
 * The active unit's order buttons over the map (map-orders.tsx), in a host beside the map rather than in it, so
 * the map's canvas does not cover them nor their clicks reach the map (#245).
 */
const ordersRoot = createRoot(document.getElementById('map-orders-host')!);
/** The layer of the windows over the page, outside the side panel. */
const overlays = document.getElementById('overlays')!;
/** The map's box, over which the turn banner is centred, clear of the side panel. */
const gameBox = document.getElementById('game')!;
/** FreeCol's InfoPanel at the map's bottom-right (info-panel.tsx), one of the map controls with the minimap. */
const infoRoot = createRoot(document.getElementById('info-panel-host')!);
function renderSide() {
  // When the last window closes the focus goes back to the map, so the next arrow key moves the unit.
  const showing = panelShowing();
  if (windowWasOpen && !showing && !mapHost.contains(document.activeElement)) mapHost.focus({ preventScroll: true });
  windowWasOpen = showing;
  menuRoot.render(<MenuBar menus={currentMenus()} status={statusLine} />);
  infoRoot.render(
    lastMap && (
      <TipProvider>
        <InfoPanel
          unit={panel(view).unit}
          idle={isIdle(noUnitHeard, lastTurn)}
          endTurn={lastMap.endTurn}
          art={art}
          centre={() => dispatch({ k: 'focus', tile: null, at: view.active?.tile ?? null })}
          endTurnNow={() => runCommand({ k: 'endTurn' })}
        />
      </TipProvider>
    ),
  );
  ordersRoot.render(
    <TipProvider>
      <MapOrders orders={side.orders} active={view.active !== null} run={(c) => runCommand(c)} art={art} />
    </TipProvider>,
  );
  sideRoot.render(
    <TipProvider>
      <TooltipLayer />
      <Side
        {...side}
        debug={
          debug
            ? { at: cursor(view)?.at ?? null, note: debugNote, request: debugRequest, skipTurns: debugSkip, resetSave }
            : undefined
        }
        run={(c) => runCommand(c)}
        save={(name) => {
          saveFile = null; // the side panel's save stays in the store
          saveGame(name);
        }}
        load={(id) => void confirmStopGame().then((go) => go && openSave(id))}
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
          if (!meta) return;
          void exportSaveFile(store, meta).then((note) => {
            if (note) side.saveNote = note;
            renderSide();
          });
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
          <DebugContext.Provider value={{ on: debug, request: debugRequest }}>
            <ShowLogContext.Provider value={() => askWorkerLog()}>
              <CopyDetailsContext.Provider value={copyErrorDetails}>
                <ColonyTiles.Provider value={drawColonyTiles}>
                  <ColonyActions.Provider value={colonyMoves}>
                    <ContextMenuContext.Provider value={contextMenus}>
                      <ReportContext.Provider value={reportActions}>
                        <DialogHost
                          dialogs={dialogQueue}
                          goTo={(at) => dispatch({ k: 'focus', tile: null, at })}
                          art={art}
                          colopedia={(type) => menuClient?.menuEntry(`colopedia:${type}`)}
                          command={(entry) => menuClient?.menuEntry(entry)}
                          string={(key) => map.resources()?.string(key) ?? ''}
                          advisor={advisor(
                            art,
                            (key) => map.resources()?.string(key) ?? '',
                            lastMap?.nation ?? '',
                            lastMap?.colonial ?? true,
                          )}
                          report={{
                            groupBy: (value) => reportButtons.groupBy(value),
                            filter: (index, shown) => reportButtons.filter(index, shown),
                            ignore: (index, ignore) => reportButtons.ignore(index, ignore),
                            open: (link) => reportButtons.open(link),
                          }}
                          routes={{
                            save: (d) => routeButtons.save(d),
                            remove: (id) => routeButtons.remove(id),
                            assign: (unit, route, show) => routeButtons.assign(unit, route, show),
                          }}
                        />
                      </ReportContext.Provider>
                    </ContextMenuContext.Provider>
                  </ColonyActions.Provider>
                </ColonyTiles.Provider>
              </CopyDetailsContext.Provider>
            </ShowLogContext.Provider>
          </DebugContext.Provider>
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
          {openOpen && (
            <OpenDialog
              saves={side.saves}
              open={openSave}
              openFile={() =>
                void openSaveFile().then((note) => {
                  openNote = note;
                  renderSide();
                })
              }
              exportSave={(id) => {
                const meta = side.saves.find((s) => s.id === id);
                if (!meta) return;
                void exportSaveFile(store, meta).then((note) => {
                  openNote = note;
                  renderSide();
                });
              }}
              note={openNote}
              close={() => {
                openOpen = false;
                renderSide();
              }}
            />
          )}
          {saveDialog && (
            <SaveDialog
              saves={side.saves}
              title={saveDialog === 'saveAndExit' ? 'Save and Exit' : 'Save Game'}
              save={(name, download) => {
                exitAfterSave = saveDialog === 'saveAndExit';
                saveDialog = null;
                if (!download) return saveGame(name);
                // No save picker here, so the target is a download; written once the save is made, as a picked file is.
                void chooseSaveFile(suggestedFileName(name)).then((target) => {
                  if (target) saveFile = { target, name: name.trim() };
                  saveGame(name);
                });
              }}
              close={() => {
                saveDialog = null;
                renderSide();
              }}
            />
          )}
          {logText !== null && (
            <LogDialog
              text={logText}
              close={() => {
                logText = null;
                renderSide();
              }}
            />
          )}
          {creditsOpen && (
            <CreditsDialog
              close={() => {
                creditsOpen = false;
                renderSide();
              }}
            />
          )}
          {/* The info panel says to end the turn; with the map controls hidden, the banner says it instead. */}
          {createPortal(<TurnBanner notice={banner} />, gameBox)}
          {createPortal(<ReloadNotice names={reloadPending(prefsAtLoad, prefs, freecolOptions)} />, gameBox)}
          {popup && <PopupMenu popup={popup} run={(id) => runMenuEntry(id)} close={() => showPopup(null)} art={art} />}
        </>,
        overlays,
      )}
    </TipProvider>,
  );
}

let view: ViewState = { ...initialView, modes: startModes(prefs) };
function dispatch(e: ViewEvent) {
  view = reduce(view, e);
  map.show(view);
  // A pan moves the map and the minimap's frame and nothing the panels show: the map is the first to be drawn, and
  // the rest waits until it has been, once however many pans come before (#420). Four React roots and the minimap
  // redone on every move cost a slow machine the frame the drag's first moves are drawn in.
  if (e.k === 'pan') return minimapAfterFrame();
  showPanel();
  renderMinimap();
}
let minimapQueued = false;
function minimapAfterFrame() {
  if (minimapQueued) return;
  minimapQueued = true;
  // After the frame that draws the map, which the map asked for in map.show.
  requestAnimationFrame(() =>
    setTimeout(() => {
      minimapQueued = false;
      renderMinimap();
    }),
  );
}
/** The last map view, which the minimap draws whole. */
let lastMap: MapView | null = null;
const minimapHost = document.getElementById('minimap-host')!;
const minimapRoot = createRoot(minimapHost);
/**
 * The minimap's width as --minimap-w on the map's box, so the order buttons over the map keep between it and the
 * info panel (#245). The minimap is drawn, skinned or not, and hidden with the side panel, so its size is watched.
 */
{
  const minimapSize = new ResizeObserver(() => {
    const m = minimapHost.querySelector('#minimap');
    document.getElementById('game')!.style.setProperty('--minimap-w', `${m?.getBoundingClientRect().width ?? 0}px`);
  });
  new MutationObserver(() => {
    minimapSize.disconnect();
    const m = minimapHost.querySelector('#minimap');
    if (m) minimapSize.observe(m);
  }).observe(minimapHost, { childList: true });
}
/** FreeCol's minimap at the map's bottom-left: one of the map controls, shown with the side panel. */
function renderMinimap() {
  minimapRoot.render(
    <TipProvider>
      <MinimapPanel
        map={lastMap}
        res={map.resources()}
        view={view}
        options={minimapOptions(prefs)}
        centre={(at) => dispatch({ k: 'centre', at })}
        setOption={(id, value) => setPrefs({ ...prefs, freecol: { ...prefs.freecol, [id]: value } })}
        art={art}
      />
    </TipProvider>,
  );
}
/** Whether the Engine has said the game started: an error before then is a game that did not start. */
let gameStarted = false;
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
  // A tile under the minimap, at the map's bottom-left, or the info panel, at its bottom-right, is out of reach too.
  const host = mapHost.getBoundingClientRect();
  const minimap = document.getElementById('minimap')?.getBoundingClientRect();
  const underMinimap =
    !!minimap && minimap.width > 0 && px < minimap.right - host.left + margin && py > minimap.top - host.top - margin;
  const info = document.getElementById('info-panel')?.getBoundingClientRect();
  const underInfo =
    !!info && info.width > 0 && px > info.left - host.left - margin && py > info.top - host.top - margin;
  if (px < margin || py < margin || px > vw - margin || py > vh - margin || underMinimap || underInfo) {
    dispatch({ k: 'focus', tile: null, at: [x, y] });
  }
  return tileOnScreen(view, [x, y]);
};

window.fcView = () => {
  const { map: _, ...rest } = view;
  const c = cursor(view);
  return { ...rest, cursor: c, cursorOnScreen: c && tileOnScreen(view, c.at) };
};

/** The debug side panel's copy of the info panel, as text: the active unit, and the tile under the pointer. */
function showPanel() {
  const { unit, tile } = panel(view);
  const cargo = unit ? [...unit.units.map((u) => u.name), ...unit.goods.map((g) => g.name)] : [];
  const lines = unit ? [unit.label, unit.status, ...cargo.map((c) => `  ${c}`)] : ['No active unit'];
  if (tile) lines.push('', tile.name ?? 'Unexplored', ...(tile.owner ? [tile.owner.name] : []));
  side.info = lines.join('\n');
  renderSide();
}

function show(status: string, extra: Record<string, unknown> = {}) {
  if (status === 'failed') {
    reportError('The game could not go on', describeError(extra.error));
    boot.fail('The game could not start');
  }
  const state = { status, rules, preset, choice, nation, autoplay, renderer: map.renderer(), rounds, ...extra };
  if (status !== 'running') window.fcResult = state;
  side.status = JSON.stringify(state, null, 1);
  renderSide();
}

/** The turn the preference last ended by itself, so a second no-unit event in it does not end it twice. */
let autoEnded: string | null = null;
/**
 * No unit left to move: end the turn, once for each turn (FreeCol's auto end turn option). Called after the
 * active unit event and after each map, since at the start of a turn the Engine says there is no unit before
 * the map says it is our turn.
 */
function autoEndTurn() {
  if (!prefs.autoEndTurn || !lastTurn || !isIdle(noUnitHeard, lastTurn) || autoEnded === lastTurn.turn) return;
  autoEnded = lastTurn.turn;
  runCommand({ k: 'endTurn' });
}
window.fcUnasked = [];
const gui: GuiHandlers = {
  events: {
    activeUnit: (e) => {
      // The Engine says which orders the active unit can take now.
      side.orders = e.orders;
      side.route = e.route;
      // Another unit (or none) takes the camera off the one that slides: it waits until that one has slid.
      const jump = pageOption(prefs, 'model.option.jumpToActiveUnit');
      viewChanges.change(() => dispatch({ k: 'activeUnit', ...e, jump }), e.unit !== view.active?.unit);
      noUnitHeard = e.unit === null ? lastTurn : undefined;
      renderSide();
      autoEndTurn();
    },
    mover: (e) => moverHold.push(e),
    selectedTile: (e) => {
      const always = pageOption(prefs, 'model.option.alwaysCenter');
      viewChanges.change(() => dispatch({ k: 'selectedTile', ...e, always }), true);
    },
    focus: (e) => viewChanges.change(() => dispatch({ k: 'focus', ...e }), true),
    animateMove: (e) => map.moved(e),
    sound: (e) => playSound(e.key),
    information: (e) => dialogQueue.show('information', e, popupClosed(e)),
    error: (e) => {
      console.error(e.text);
      // The server refusing to start the game (PreGameController.requestLaunch) is the only word a game that never
      // starts gives: show it as the failed start it is, not as a dialog behind the loading screen.
      if (!gameStarted) show('failed', { error: e.text });
      dialogQueue.show('error', e, popupClosed(e));
    },
    eventPanel: (e) => dialogQueue.show('eventPanel', e, popupClosed(e)),
    indianSettlement: (e) => dialogQueue.show('indianSettlement', e),
    tilePanel: (e) => dialogQueue.show('tilePanel', e),
    findSettlement: (e) => dialogQueue.replace('findSettlement', e),
    workProduction: (e) => dialogQueue.replace('workProduction', e),
    colopedia: (e) => dialogQueue.replace('colopedia', e),
    highScores: (e) => dialogQueue.show('highScores', e),
    tradeRoutes: (e) => dialogQueue.replace('tradeRoutes', e),
    europe: (e) => showEurope(dialogQueue, e),
    options: (e) => dialogQueue.replace('options', e, (open) => open.kind === e.kind),
    // A report that is open is replaced: a link in it opens a detail in its place.
    report: (e) => dialogQueue.replace('report', e),
    messages: (raw) => {
      const e = { ...raw, messages: visibleMessages(prefs, raw.messages) };
      if (e.regrouped) dialogQueue.replace('messages', e, (open) => open.title === e.title);
      // The turn report (it has the group by option) opens even with no messages, and says so.
      else if (e.messages.length > 0 || e.groupBy) dialogQueue.show('messages', e, popupClosed(e));
      // Messages the preferences hide all of are no pop-up: nothing waits for it.
      else popupClosed(e)();
    },
    // A colony already open or queued is shown again in its place, else it opens.
    // It waits for the arriving unit's slide: a goto's arrival, a move into the colony and a landing all show it.
    colony: (e) => {
      void afterSlide(() => dialogQueue.replace('colony', e, (open) => open.id === e.id, true));
    },
    closeColony: (e) => dialogQueue.remove('colony', (open) => open.id === e.id),
    // The window stays and shows the other colony; the other's own panel, if open too, makes way for it.
    stepColony: (e) => {
      if (e.colony.id !== e.from) dialogQueue.remove('colony', (open) => open.id === e.colony.id);
      dialogQueue.replace('colony', e.colony, (open) => open.id === e.from, true);
    },
    coverage: (e) => window.fcCoverageHit?.(e.method),
    unasked: (e) => {
      console.warn(`WebGUI: no dialog yet for ${e.method}; FreeCol's default was used`);
      side.unasked = [...side.unasked, e.method];
      window.fcUnasked = side.unasked;
      renderSide();
    },
  },
  questions: {
    event: (q) => afterSlide(() => dialogQueue.ask('event', q)),
    confirm: (q) => afterSlide(() => dialogQueue.ask('confirm', q)),
    declaration: (q) => afterSlide(() => dialogQueue.ask('declaration', q)),
    choice: (q) => afterSlide(() => dialogQueue.ask('choice', q)),
    input: (q) => afterSlide(() => dialogQueue.ask('input', q)),
    amount: (q) => afterSlide(() => dialogQueue.ask('amount', q)),
    goods: (q) => afterSlide(() => dialogQueue.ask('goods', q)),
    endTurn: (q) => afterSlide(() => dialogQueue.ask('endTurn', q)),
    preCombat: (q) => afterSlide(() => dialogQueue.ask('preCombat', q)),
    negotiation: (q) => afterSlide(() => dialogQueue.ask('negotiation', q)),
    names: (q) => afterSlide(() => dialogQueue.ask('names', q)),
    father: (q) => afterSlide(() => dialogQueue.ask('father', q)),
    warehouse: (q) => afterSlide(() => dialogQueue.ask('warehouse', q)),
  },
};

/** A question or the colony panel opens once the unit that moved has slid to its tile: a move's new region, first contact or a ship's arrival comes after it. */
const afterSlide = slideGate(() => map.settled());
/**
 * The view changes the Engine asks for, in order: one that takes the camera off the unit that slides (the next
 * active unit, a selected tile) waits until it has slid, as Swing finishes a move before the view moves on.
 */
const viewChanges = viewHold(
  () => map.sliding(),
  () => map.settled(),
);
window.fcSettled = async () => {
  await map.settled();
  await viewChanges.idle();
};

/** The tab's title follows the last map, and says it is the player's turn while the tab is hidden (tab-title.ts). */
function showTabTitle() {
  document.title = tabTitle(lastMap, document.hidden);
}
document.addEventListener('visibilitychange', showTabTitle);

/** Whether the first map has been sent to be drawn: the loading screen waits for it. */
let mapShown = false;
function drawMap(m: MapView) {
  nation = m.nation;
  side.turn = `${m.turn}${m.ourTurn ? '' : ' (AI playing)'}`;
  statusLine = m.statusLine;
  // A new turn's notice stays through the maps of its turn; the AI's goes when play comes back.
  if (m.ourTurn) moverHold.clear();
  banner = turnNotice(lastTurn, m, mover) ?? (banner?.kind === 'new' && m.ourTurn ? banner : null);
  // FreeCol's disable end turn background option: no banner while the others move.
  if (banner?.kind === 'ai' && pageOption(prefs, 'model.option.disableGrayLayer')) banner = null;
  const newTurn = lastTurn?.turn !== m.turn;
  lastTurn = m;
  if (newTurn) refreshOverlay();
  autoEndTurn();
  // The first map is the game as loaded or started; each one after it is play the saves do not hold yet.
  if (lastMap && autoplay === 0) leaveAsk.changed();
  if (m.ourTurn) autosaveSoon();
  turnAutosave(m);
  renderSide();
  lastMap = m;
  showTabTitle();
  viewChanges.change(() => dispatch({ k: 'map', map: m }), false);
  pullColonies();
  drawn = map.draw(m);
  if (!mapShown) {
    mapShown = true;
    void drawn.finally(() => boot.finish('map'));
  }
  // A dialog shown before the art manifest loaded has no images: draw it again once they can be had.
  if (!artReady)
    void drawn.then(() => {
      if (!map.resources()) return;
      artReady = true;
      controlArt(document.documentElement, art);
      showCompass(pageOption(prefs, 'model.option.displayCompassRose'));
      renderSide();
      renderMinimap();
    });
}

blockBrowserMenu(document);
blockImageDrag(document);
// The browser's zoom is the player's UI scale instead (Preferences, display scaling), and its page keys are off.
blockBrowserKeys(document, mapHost, (step) =>
  setPrefs({
    ...prefs,
    freecol: {
      ...prefs.freecol,
      'model.option.displayScaling': steppedScale(Math.round(uiZoom(prefs) * 100), step),
    },
  }),
);
/** The client Engine, once loaded: a held Go To asks it for the path and sends the unit. */
let gotoClient: ClientExports | null = null;
const gotoDeps: GotoDeps = {
  preview: (tile, unit) =>
    dispatch({
      k: 'preview',
      path: tile && unit && gotoClient ? (JSON.parse(gotoClient.pathToUnit(unit, ...tile)) as PathStep[] | null) : null,
    }),
  go: (tile, unit) => gotoClient?.goToUnit(unit, ...tile),
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
  () => view.active?.unit ?? null,
);

/** Hook the player's input up to the client Engine's commands. */
function playWith(client: ClientExports) {
  const run = (c: Command) => {
    // The same two actions are disabled in Swing, so the E key and the buttons do nothing either.
    if ((c.k === 'declareIndependence' && !canDeclare()) || (c.k === 'showEurope' && !hasEurope())) return;
    if (c.k === 'move') client.move(c.direction);
    // ClearOrdersAction: the same as Clear orders in the unit's menu.
    else if (c.k === 'clearOrders') {
      if (view.active) client.menuEntry(`clear:${view.active.unit}`);
    }
    // ChangeAction: a click on the active unit's tile opens its colony or cycles its units.
    else if (c.k === 'change') {
      if (view.active?.tile) client.click(...view.active.tile, 1);
    } else client[c.k]();
  };
  runCommand = run;
  menuReady = true;
  gotoClient = client;
  renderSide();
  addEventListener('keydown', (e) => {
    // A key typed into a text field (a save's name, a colony's) is text: no game key runs. The feedback window has
    // its own radio buttons and checkboxes, whose keys are not the game's either.
    if (inTextField(e.target) || (e.target instanceof Element && e.target.closest('#feedback-host'))) return;
    // An open dialog has the keys (panels.tsx).
    // A report's hotkey (Shift+F3, ...) opens it over another report, but not over another dialog.
    const report = reportForKey(e);
    if (report && !e.repeat && [undefined, 'report'].includes(dialogQueue.current()?.kind)) {
      e.preventDefault();
      reportActions.open(report);
      return;
    }
    // ReportTurnAction's key shows this turn's report again, over another report or over the report itself.
    if (isTurnReportKey(e) && !e.repeat && [undefined, 'report'].includes(dialogQueue.current()?.kind)) {
      e.preventDefault();
      run({ k: 'showTurnReport' });
      return;
    }
    // FreeCol's accelerators for the Game menu and Centre on the active unit (accelerators.ts). They keep the
    // browser's own save, open, print and new window away, and leave Ctrl+X and Ctrl+C to a text field.
    const accel = acceleratorFor(e);
    if (accel && accel !== 'fullScreen' && !dialogQueue.current() && !e.repeat) {
      const a = menuActions();
      const act: Record<Exclude<Accelerator, 'fullScreen'>, (() => void) | false> = {
        new: a.newGame,
        open: a.open,
        save: a.ready && !a.panelShowing && a.save,
        saveAndExit: a.ready && !a.panelShowing && a.saveAndExit,
        quit: a.returnToMain,
        preferences: a.preferences,
        centre: a.hasActiveUnit && a.centreOnUnit,
      };
      const entry = act[accel];
      // Ctrl+C keeps copying a selection.
      const copying = accel === 'centre' && !!getSelection()?.toString();
      if (entry && !copying) {
        e.preventDefault();
        entry();
        return;
      }
    }
    // TilePopupAction: Shift+T opens the popup of the active unit's tile.
    if (e.key === 'T' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !dialogQueue.current()) {
      const tile = view.active?.tile;
      const canvas = mapHost.querySelector('canvas');
      const menu = tile && canvas && parseMenu(client.tileMenu(...tile));
      if (tile && canvas && menu) {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const [px, py] = tileOnScreen(view, tile);
        showPopup({ menu, x: r.left + px, y: r.top + py });
      }
      return;
    }
    // Ctrl+F is FindSettlementAction's accelerator, in place of the browser's find.
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'f' && !dialogQueue.current()) {
      e.preventDefault();
      run({ k: 'findSettlement' });
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
    // Tab changes units only with nothing focused, so it still tabs between the page's buttons.
    if (e.key === 'Tab' && e.target !== document.body && e.target !== mapHost) return;
    const c = commandForKey(e, side.orders);
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
      const menu = debugTileEntries(parseMenu(client.tileMenu(...tile)), tile);
      showPopup(menu && { menu, x, y });
    },
  );
  mapHost.addEventListener('click', (e) => {
    const at = onCanvas(mapHost, e);
    const tile = at && !dragged() ? map.tileAt(...at) : null;
    if (tile) client.click(...tile, e.detail);
  });
}

/**
 * The data bundle with the strings of the language the player picked (FreeCol's language option, read as
 * the page loads), and that language's id. A translation that fails to load leaves the game in English.
 */
async function withLanguage(bundle: string[]): Promise<{ data: string[]; language: string }> {
  const available = languages(bundle);
  const language = pickLanguage(pageOption(prefsAtLoad, LANGUAGE_OPTION), available, navigator.languages);
  try {
    const files = await Promise.all(
      translationFiles(language, available).map(async (path) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`${path} gave ${res.status}`);
        return [`data/${path}`, await res.text()];
      }),
    );
    return { data: [...bundle, ...files.flat()], language };
  } catch (ex) {
    reportError(`FreeCol's text could not be loaded in ${languageName(language)}`, String(ex));
    return { data: bundle, language: 'en' };
  }
}

/** The client module, loaded once: the start screen's Colopedia and the game share it. */
let loadedClient: Promise<ClientExports> | null = null;
const clientModule = () =>
  (loadedClient ??= loadModule<ClientExports>(runtimeUrl, clientUrl, (loaded, total) =>
    boot.progress('engine', loaded, total),
  ).then((exports) => {
    boot.finish('engine');
    return exports;
  }));

/** A preset's JSON: a bare name is presets/NAME.json of this build. */
async function fetchPreset(name: string): Promise<string> {
  const url = name.endsWith('.json') ? name : `presets/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`preset ${name}: ${url} gave ${res.status}`);
  return res.text();
}

/**
 * The start screen, until the player starts the game: resolves to the preset JSON the choice makes, and the bytes
 * of the map or save file the player picked for the map generator to import, if any.
 */
/** @param note Shown where the save files open, as why a save the address named did not load. */
async function chooseGame(
  data: string[],
  language: string,
  note = '',
): Promise<{ preset: string; importMap?: Uint8Array }> {
  // FreeCol's main panel offers Continue Playing and Open: the saves in the store, newest first.
  const saves = await store.list().catch(() => []);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  // FreeCol's main panel plays the introduction music; the browser lets it start on the player's first choice (#272).
  void sound.then((s) => s?.waitForChoice(true));
  const chosen = () => void sound.then((s) => s?.choose());
  playSound('sound.intro.general');
  // The screen goes once the start screen has had a frame to draw in.
  requestAnimationFrame(() => boot.finish('start'));
  return new Promise((done) => {
    // Drawn again with why a save file would not open, if one does not.
    const draw = (openNote: string) =>
      root.render(
        // The setup's option rows explain themselves on hover (FreeCol's short descriptions): the start screen
        // needs its own tooltip layer, as the side panel's is not mounted before a game.
        <TipProvider>
          <TooltipLayer />
          <StartScreen
            key={rules}
            openFile={() => void openSaveFile().then(draw)}
            openNote={openNote}
            exportSave={(id) => {
              const meta = saves.find((s) => s.id === id);
              if (meta) void exportSaveFile(store, meta).then(draw);
            }}
            options={startOptions(data, rules)}
            rules={rules}
            setup={startSetup}
            changeRules={(id, setup) => {
              // The data bundle holds every ruleset, so the start screen switches in place; the address keeps
              // the choice for a reload. Its nations and options differ, so the screen starts afresh (key),
              // keeping what of the setup the new ruleset still has.
              rules = id;
              startSetup = setup;
              const next = new URLSearchParams(location.search);
              next.set('rules', id);
              history.replaceState(history.state, '', `?${next}`);
              draw(openNote);
            }}
            saves={saves}
            open={openSave}
            chosen={chosen}
            sound={{
              music: !prefs.muteMusic,
              effects: !prefs.muteEffects,
              setMusic: (on) => {
                setPrefs({ ...prefs, muteMusic: !on });
                draw(openNote);
              },
              setEffects: (on) => {
                setPrefs({ ...prefs, muteEffects: !on });
                draw(openNote);
              },
            }}
            // No client Engine exists yet: the Colopedia comes from the client module's rules-only entry.
            colopedia={async (select) =>
              colopediaBefore<ReportView & { report: 'colopedia' }>(
                await clientModule(),
                globalThis as unknown as Scope,
                language,
                data,
                rules,
                select,
              )
            }
            art={art}
            start={(c) => {
              root.unmount();
              host.remove();
              boot.begin(gameParts);
              // The browser has no file system for the server Engine to read the file from: hand it the bytes.
              void (c.importMap?.arrayBuffer() ?? Promise.resolve(undefined)).then(
                (bytes) => done({ preset: presetJson(c), importMap: bytes && new Uint8Array(bytes) }),
                (ex: unknown) => {
                  // A file the browser can no longer read: start on a generated map and say so.
                  reportError('The map file could not be read', String(ex));
                  done({ preset: presetJson(c) });
                },
              );
            }}
          />
        </TipProvider>,
      );
    draw(note);
  });
}

/**
 * FreeCol's Loading Save game window, if the save game dialog option shows it: resolves once the
 * player goes on. Cancel leaves the save, as FreeCol goes back to its main panel: the page reloads
 * on a new game.
 */
async function confirmLoad(id: number): Promise<void> {
  if (!showsLoadingSave(pageOption(prefs, 'model.option.showSavegameSettings'))) return;
  const save = await store
    .list()
    .then((all) => all.find((m) => m.id === id) ?? null)
    .catch(() => null);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  boot.pause();
  return new Promise((done) => {
    root.render(
      <LoadingSaveDialog
        save={save}
        load={() => {
          close();
          boot.begin(startupParts());
          done();
        }}
        cancel={() => {
          const next = new URLSearchParams(location.search);
          next.delete('load');
          leavePage(next.toString());
        }}
      />,
    );
  });
}

/**
 * FreeCol's confirmStopGame (stopCurrentGame.*), asked before a running game is dropped for a new one
 * or a loaded one; Cancel is the default, as in Swing. Resolves to whether to go on.
 */
function confirmStopGame(): Promise<boolean> {
  return dialogQueue.ask('confirm', {
    text: 'A game is already running.',
    ok: 'Stop Game',
    cancel: 'Cancel',
    defaultOk: false,
    tile: null,
    object: null,
    header: null,
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
      leavePage(next.toString());
    });
}

/** Wait for the player to stop changing things for this long before autosaving. */
const AUTOSAVE_MS = 1500;
/** Whether this page is a fresh start the autosave may replace: not a debug start, not a scripted run. */
const mayResume = !params.has('new') && !params.has('skipstart') && !params.has('preset') && autoplay === 0;

/** What a page waits for before the player sees the start screen, or the map when there is no start screen. */
const startupParts = (): PartName[] => (skipStart ? ['data', 'engine', 'art', 'map'] : ['data', 'start']);
/** What it waits for once the player has started the game from the start screen. */
const gameParts: PartName[] = ['engine', 'art', 'map'];

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
  // A save the address names that the store no longer has (a loaded autosave is replaced by the next one, so
  // a reload names one that is gone, #394): the start screen, with its saves, says so instead of a failed game.
  let missingNote = '';
  if (loadId !== undefined && !resumed) {
    const note = await missingSaveNote(store, loadId);
    if (note !== null) {
      missingNote = note;
      loadId = undefined;
      skipStart = params.has('skipstart') || params.has('preset');
      const next = new URLSearchParams(location.search);
      next.delete('load');
      history.replaceState(history.state, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
    }
  }
  boot.begin(startupParts());
  const bundle = (await (await fetch(dataUrl)).json()) as string[];
  const { data, language } = await withLanguage(bundle);
  boot.finish('data');
  const clientOptions = clientOptionsGroup(data);
  if (clientOptions) {
    freecolOptions = shownClientOptions(clientOptions);
    freecolDefaults = new Map([...leaves(clientOptions)].map(([id, o]) => [id, o.value]));
  }
  // A save the player picked, not the autosave the page resumed by itself.
  if (loadId !== undefined && !resumed) await confirmLoad(loadId);
  const { preset: chosen, importMap } = skipStart
    ? { preset: '', importMap: undefined }
    : await chooseGame(data, language, missingNote);
  choice = chosen;
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // An error the Worker does not catch, such as a trap in the server Engine, stops the game's server.
  askWorkerLog = () => worker.postMessage({ k: 'log' } satisfies ToWorker);
  askWorkerLogQuietly = askWorkerLog;
  worker.addEventListener('error', (e) => reportError('The game server hit an error', e.message || 'unknown error'));
  worker.addEventListener('messageerror', () =>
    reportError('The game server sent a message the page could not read', ''),
  );
  const presetJson = preset ? await fetchPreset(preset) : chosen;
  const client = startPage({
    worker,
    loadClient: clientModule,
    data,
    language,
    rules,
    load: loadId,
    preset: presetJson,
    importMap,
    autoplay,
    scope: globalThis as unknown as Scope,
    gui,
    onEvent: async (name, detail) => {
      // A failure the game goes on after; one it does not ("failed", a load that fails) goes on the banner through show().
      const failure = engineError(name, detail);
      if (failure) reportError(failure.title, failure.detail);
      switch (name) {
        case 'gameStarted':
          gameStarted = true;
          if (debug) debugRequest({ action: 'players' });
          // PreGameController.startGame: the default playlist plays whenever no other music does.
          void sound.then((s) => s?.startPlaylist());
          // The sound effects are fetched and decoded now, so that the first one asked for plays at once (#391).
          void sound.then((s) => s?.preloadEffects());
          // PreGameController.startGame: the delete autosaves option clears them as a new game starts.
          if (loadId === undefined && autosaveOptions(prefs).deleteOnNewGame) {
            void dropTurnAutosaves(store, autosaveOptions(prefs)).catch(console.warn).finally(listSaves);
          }
          return drawMap(JSON.parse(detail) as MapView);
        case 'map':
          return drawMap(JSON.parse(detail) as MapView);
        case 'log':
          // The Worker's log, asked for by the error dialog or the banner.
          return showWorkerLog(detail);
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
          saveFailShown = false;
          leaveAsk.saved();
          const auto = autosaveOptions(prefs);
          const quiet = isAutosave(meta) || isTurnAutosave(auto, meta);
          const pending = saveFile;
          // The player's save, made for the file they picked: the save of that name, or with the default name the
          // first one not an autosave. Written there, then on as for any save.
          if (pending && (meta.name === pending.name || !quiet)) {
            const target = pending.target;
            saveFile = null;
            return void store
              .get(meta.id)
              .then((bytes) => {
                if (!bytes) throw new Error('the save is gone from the store');
                return target.write(bytes);
              })
              .then(() => {
                side.saveNote = `Saved: ${target.name}`;
                if (exitAfterSave) returnToMain();
              })
              .catch((ex: unknown) => {
                exitAfterSave = false; // a game that is not in its file is not left
                side.saveNote = `Save failed: ${String(ex)}`;
                reportError(`The save could not be written to ${target.name}`, String(ex));
              })
              .finally(listSaves);
          }
          if (exitAfterSave && !saveFile && !quiet) return returnToMain();
          if (isAutosave(meta)) {
            // A loaded game has its own autosave now, which drops the save it loaded if that was an autosave: the
            // address resumes the autosave rather than name that save, so a reload goes on with this game (#394).
            const resume = resumeSearch(location.search);
            if (resume !== null) history.replaceState(history.state, '', `${location.pathname}${resume}`);
            // One slot: the new autosave replaces the old ones, quietly.
            return void dropOlderAutosaves(store, meta).catch(console.warn).finally(listSaves);
          }
          if (isTurnAutosave(auto, meta)) {
            // Quietly too; a new last-turn save moves the old one to before-last-turn.
            const shifted =
              meta.name === lastTurnSaveName(auto) ? shiftLastTurnSaves(store, auto, meta) : Promise.resolve();
            return void shifted.catch(console.warn).finally(listSaves);
          }
          side.saveNote = `Saved: ${meta.name}`;
          return listSaves();
        }
        case 'saveFailed':
          exitAfterSave = false; // a game that did not save is not left
          saveFile = null;
          side.saveNote = `Save failed: ${detail}`;
          // On the banner, once until a save works again: autosaves fail too, and would raise it each time.
          if (!saveFailShown) reportError(saveFailedTitle(detail), detail);
          saveFailShown = true;
          return renderSide();
        case 'loadFailed':
          if (resumed && loadId !== undefined) {
            // An autosave the Engine can no longer read (it changed under it): drop it and start afresh.
            console.warn('autosave would not load, starting afresh:', detail);
            return resetSave();
          }
          return show('failed', { error: detail });
        case 'debug': {
          const answer = JSON.parse(detail) as { action: string; value?: number } & Partial<OverlayAnswer> & {
              players?: DebugPlayer[];
            };
          if (answer.action === 'overlay') {
            return dispatch({ k: 'overlay', overlay: { labels: answer.labels ?? [], tints: answer.tints ?? [] } });
          }
          if (answer.action === 'players') {
            debugPlayers = answer.players ?? [];
            return renderSide();
          }
          if (answer.action === 'stepRNG') return stepRNG(answer.value);
          // A choice to make (the new owner, a role...): ask, and send the request again with it.
          const again = chosenRequest(detail, lastDebug, (prompt, first) => window.prompt(prompt, first));
          if (again) return debugRequest(again);
          debugNote = again === null ? 'Cancelled' : describeAnswer(detail);
          return renderSide();
        }
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
    // Ask the browser not to evict the saves. Only a page can ask, not the Worker, and Firefox asks the
    // player, so it goes with a save the player chose to make.
    void keepSaves(navigator.storage);
    side.saveNote = 'Saving...';
    renderSide();
    const m: ToWorker = { k: 'save', active: exports.activeUnitId(), name };
    leaveAsk.saving();
    worker.postMessage(m);
  };
  // Autosave a moment after the player's last change, so a reload (a dev rebuild, say) loses nothing.
  const autosave = debounced(() => {
    if (!lastTurn?.ourTurn) return;
    leaveAsk.saving();
    worker.postMessage({ k: 'save', active: exports.activeUnitId(), name: AUTOSAVE_NAME } satisfies ToWorker);
  }, AUTOSAVE_MS);
  autosaveSoon = () => {
    if (autoplay === 0) autosave();
  };
  saveNamed = (name) => {
    leaveAsk.saving();
    worker.postMessage({ k: 'save', active: exports.activeUnitId(), name } satisfies ToWorker);
  };
  waitingSaves.splice(0).forEach(saveNamed);
  // A game runs once its first turn has been shown.
  setCurrentSaveSource(
    snapshotter(
      worker,
      () => lastTurn !== null,
      () => exports.activeUnitId(),
    ),
  );
  colonyNow = (id) => exports.colony(id);
  colonyClient = exports;
  popupClient = exports;
  pushFreecolOptions(prefs.freecol);
  debugRequest = (r) => {
    lastDebug = r;
    worker.postMessage(debugMessage(r));
  };
  debugClient = (r) => exports.debugClient(JSON.stringify(r));
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
    open: (link) => (link.kind === 'colony' ? reportActions.colony(link.id) : reportActions.europe()),
  };
  routeButtons = {
    save: (d) => exports.saveTradeRoute(JSON.stringify(d)),
    remove: (id) => exports.deleteTradeRoute(id),
    assign: (unit, route, show = true) =>
      show ? exports.assignTradeRoute(unit, route ?? '') : exports.confirmTradeRoute(unit, route ?? ''),
  };
  Object.assign(europeButtons, {
    recruit: (i: number) => exports.recruitUnit(i),
    train: (id: string) => exports.trainUnit(id),
    board: (unit: string, ship: string) => exports.boardShip(unit, ship),
    leave: (unit: string) => exports.leaveShip(unit),
    buy: (goods: string, ship: string, ask: boolean) => exports.buyGoods(ship, goods, ask),
    sell: (goods: string, ship: string, ask: boolean, stack: number) => exports.sellGoods(ship, goods, ask, stack),
    transfer: (from: string, to: string, goods: string, stack: number) => exports.transferGoods(from, to, goods, stack),
    sail: (ship: string) => exports.sailToNewWorld(ship),
    redirect: (ship: string, toEurope: boolean) => exports.redirectShip(ship, toEurope),
    unload: (ship: string) => exports.menuEntry(`unloadEurope:${ship}`),
  });
  playWith(exports);
}

// FreeCol drops the outdated autosaves as it quits; the browser, as the page loads.
dropOutdatedAutosaves(store, autosaveOptions(prefs), Date.now()).catch(console.warn).finally(listSaves);
show('running');
run().catch((ex) => show('failed', { error: String(ex) }));
