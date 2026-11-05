// The postMessage routing between the page, which hosts the client Engine
// (client.wasm), and the Worker, which hosts the server Engine (server.wasm).
//   page -> worker: data (the bundle, once) | start | load | save | debug | connect | fc
//   worker -> page: fc | event
// A debug request (debug mode only, debug.ts) goes to the server Engine, which
// changes its game and answers with a "debug" event, or "debugFailed"; the
// page hands the answer to the client Engine for its own part of the change.
// The Worker also keeps the saved games (saves.ts): a save request carries the
// client's active unit, the server Engine makes the .fsg, and the Worker puts it
// in IndexedDB; a load request names a save, which the Worker hands the server
// Engine in place of a new game.
// The page fetches the data bundle and hands it over, so it is downloaded once.
// The client Engine's WebGUI talks to the page alone, through webgui.ts.
import { newSave, type SavedInfo, type SaveStore } from './saves';
import { webGui, type GuiHandlers } from './webgui';

/** Exports of the server module (online.freecol.web.WorkerMain). */
export interface ServerExports {
  /** The language of FreeCol's text, a translation's id (language.ts); called before main. */
  setLanguage(id: string): void;
  main(args: string[]): void;
  /** `preset` is a GamePreset's JSON ("" for none); a bad one fails with a message. */
  startGame(rules: string, preset: string): void;
  /** Save the game; the bytes go out through fcSaved and then a "saved" event. */
  saveGame(activeUnitId: string): void;
  /** Replace the game with the one in a savegame; a "loaded" event follows. */
  loadGame(savegame: Int8Array): void;
  /** Run a debug action (DebugActions.java); a "debug" or "debugFailed" event follows. */
  debug(request: string): void;
  /** Run the preset's setup requests; "debug" events follow, or "debugFailed". */
  setup(): void;
  connect(): void;
  receive(xml: string): void;
}

/** Exports of the client module (online.freecol.web.ClientMain). */
export interface ClientExports {
  /** The language of FreeCol's text, a translation's id (language.ts); called before main. */
  setLanguage(id: string): void;
  main(args: string[]): void;
  /** Log in as `name` (a loaded game's owner; empty for a new game) and play `rounds` rounds. */
  startGame(rounds: number, name: string): void;
  /** Debug mode: skip turns with the AI playing, then play returns ("finished"). */
  skipTurns(rounds: number): void;
  /** Debug mode: the server's answer to a debug request; the client's part of it, then a map. */
  debugApplied(answer: string): void;
  /** The id of the active unit, or "" for none: what a save request carries. */
  activeUnitId(): string;
  receive(xml: string): void;
  /** Our colony with this id as the colony panel shows it (ColonyJson), or "null" if it is not ours now. */
  colony(id: string): string;
  /** Answer a WebGUI question; null for a closed dialog. */
  answer(id: number, value: string | null): void;
  // Player commands (Commands.java). Each returns at once and sends a "map"
  // event when done; the Engine runs them one at a time, and queues one that
  // comes while another runs.
  /** Select our unit on a tile, or open the settlement there; with neither, nothing. */
  click(x: number, y: number, count: number): void;
  /** Send the active unit to a tile along its best path. */
  goTo(x: number, y: number): void;
  /** The path the active unit would take to a tile, as JSON [x, y, turns] per step, or "null". */
  pathTo(x: number, y: number): string;
  /** Move the active unit one step; a FreeCol Direction name, e.g. "NE". */
  move(direction: string): void;
  nextUnit(): void;
  buildColony(): void;
  endTurn(): void;
  /** Europe panel: recruit the unit at an index of the docks. */
  recruitUnit(index: number): void;
  /** Europe panel: train or buy a unit of a type, by id. */
  trainUnit(unitTypeId: string): void;
  /** Europe and colony panels: put a unit aboard a ship beside it, by ids. */
  boardShip(unitId: string, shipId: string): void;
  /** Europe panel: buy goods of a type onto a ship in port, by ids; ask asks how much, else the most. */
  buyGoods(shipId: string, goodsTypeId: string, ask: boolean): void;
  /** Europe panel: sell a ship's cargo in Europe, by ids; ask asks how much, else the stack (stack 0: all of the type). */
  sellGoods(shipId: string, goodsTypeId: string, ask: boolean, stack: number): void;
  /** Europe panel: move goods between two ships in port, by ids (stack 0: all of the type). */
  transferGoods(fromShipId: string, toShipId: string, goodsTypeId: string, stack: number): void;
  /** Europe panel: turn a ship on the high seas around, by id. */
  redirectShip(shipId: string, toEurope: boolean): void;
  /** Colony panel: take a unit off a ship in port, by id. */
  leaveShip(unitId: string): void;
  /** Colony panel: goods of the warehouse dropped on a colonist equip it with the role they give, by ids. */
  equipUnit(unitId: string, goodsTypeId: string): void;
  /** Colony panel: load goods of a type from the warehouse onto a ship in port; ask asks the amount. */
  loadGoods(shipId: string, goodsTypeId: string, ask: boolean): void;
  /** Colony panel: unload a stack of a ship's goods into the warehouse; ask asks the amount. */
  unloadGoods(shipId: string, goodsTypeId: string, stack: number, ask: boolean): void;
  /** Europe panel: send a ship in port to the New World, by id. */
  sailToNewWorld(shipId: string): void;
  /** Declare independence (DeclareIndependenceAction). */
  declareIndependence(): void;
  /** Retire from the game (RetireAction). */
  retire(): void;
  /** Show the high score table (ReportHighScoresAction). */
  showHighScores(): void;
  /** Show the Europe panel (EuropeAction). */
  showEurope(): void;
  /** Open the Find Settlement panel (FindSettlementAction). */
  findSettlement(): void;
  /** Show the game options, read-only (ShowGameOptionsAction). */
  showGameOptions(): void;
  /** Show the map generator options, read-only (ShowMapGeneratorOptionsAction). */
  showMapGeneratorOptions(): void;
  /** Show the game's difficulty level, read-only (ShowDifficultyAction). */
  showDifficulty(): void;
  /** The standing orders of the active unit. */
  fortify(): void;
  sentry(): void;
  skip(): void;
  disband(): void;
  unload(): void;
  plow(): void;
  clearForest(): void;
  road(): void;
  /** The right-click menu of a map tile, as JSON (Menus.tile), or "null" for none. */
  tileMenu(x: number, y: number): string;
  /** The quick action menu of one of our colonists or ships in a colony (Menus.unit), as JSON or "null". */
  unitMenu(unitId: string): string;
  /** The menu of a tile in the colony panel's grid (Menus.colonyTile), as JSON or "null". */
  colonyTileMenu(x: number, y: number): string;
  /** The quick action menu of goods in a colony or aboard a ship in port (Menus.goods), as JSON or "null". */
  goodsMenu(locationId: string, goodsTypeId: string, amount: number): string;
  /** Run the entry picked in a menu, by its id (Commands.menuEntry). */
  menuEntry(id: string): void;
  /** Colony panel: put a colonist to work at a building or colony tile, by ids. */
  work(unitId: string, locationId: string): void;
  /** Colony panel: put a colonist outside the colony. */
  putOutsideColony(unitId: string): void;
  /** Colony panel: change the goods a working colonist makes. */
  changeWorkType(unitId: string, goodsTypeId: string): void;
  /** Colony panel: set a colony's build queue, the ids of what to build in order, joined by commas. */
  setBuildQueue(colonyId: string, typeIds: string): void;
  /** Colony panel: pay for what the colony is building now (the player confirms the price). */
  payForBuilding(colonyId: string): void;
  /** Colony panel: close it, asking first whether to abandon a colony with no colonist left; a "closeColony" event closes it. */
  closeColonyPanel(colonyId: string): void;
  /** Colony panel: close it and open the previous (-1) or next (1) colony's panel, in the player's colony order. */
  stepColony(colonyId: string, by: number): void;
  /** Colony panel: open the colony's warehouse dialog (the player sets the levels and the custom house exports). */
  warehouse(colonyId: string): void;
  /** Send the active unit to a destination; the player is asked where. */
  selectDestination(): void;
  /** Open a report of the Report menu by name: colony, labour or compactLabour (Commands.showReport). */
  report(name: string): void;
  /** Open the details a report links to, of a unit type by id (Commands.showReportDetail). */
  reportDetail(name: string, id: string): void;
  /** Open the panel of one of our colonies, by id, as a link in a report does. */
  showColony(id: string): void;
  /** Open the trade routes panel with no unit (TradeRouteAction). */
  tradeRoutes(): void;
  /** Open the trade routes panel for the active carrier (AssignTradeRouteAction). */
  assignRoute(): void;
  /** Create or change a trade route: a TradeRouteDraft as JSON. The panel is sent again. */
  saveTradeRoute(json: string): void;
  /** Delete a trade route, by its id. The panel is sent again. */
  deleteTradeRoute(id: string): void;
  /** Make a unit follow a trade route; an empty route id drops its route. */
  assignTradeRoute(unit: string, route: string): void;
  /** As assignTradeRoute, but the panel is not sent again: its OK button closes it. */
  confirmTradeRoute(unit: string, route: string): void;
  // The turn report's buttons (WebGUI.reportGroupBy and the others). Each message is named by its
  // place in the report as shown.
  /** Group the report by 0 nothing, 1 type or 2 source; the report is shown again, regrouped. */
  reportGroupBy(value: number): void;
  /** Show or filter out the type of a message. */
  reportFilter(index: number, shown: boolean): void;
  /** Ignore a message, or stop. */
  reportIgnore(index: number, ignore: boolean): void;
  /** Send the map again, as an option that changes it (display fog of war) asks. */
  refreshMap(): void;
  /** FreeCol's client options that take a boolean or whole number, as JSON {id: value}. */
  clientOptionValues(): string;
  /** Set one of FreeCol's client options: "true", "false" or a whole number. Returns whether it took. */
  setClientOption(id: string, value: string): boolean;
}

export type ToWorker =
  | { k: 'data'; data: string[]; language: string }
  | { k: 'start'; rules: string; preset: string }
  | { k: 'load'; id: number }
  | { k: 'save'; active: string; name: string }
  | { k: 'debug'; request: string }
  | { k: 'setup' }
  | { k: 'connect' }
  | { k: 'fc'; xml: string };

export type ToPage = { k: 'fc'; xml: string } | { k: 'event'; name: string; detail: string };

/** Either end of the channel: a Worker, the Worker's global scope or a MessagePort. */
export interface Endpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  start?(): void;
}

/** Where the Java side looks up the globals its @JSBody methods call. */
export type Scope = Record<string, unknown>;

function listen<T>(endpoint: Endpoint, handle: (m: T) => void): void {
  endpoint.addEventListener('message', (e) => handle(e.data as T));
  endpoint.start?.();
}

const describe = (ex: unknown) => (ex instanceof Error ? (ex.stack ?? ex.message) : String(ex));

/**
 * Worker side: load the server module, start it on the data bundle the page
 * sends, then route the page's messages to it. Messages that arrive while
 * the module still loads are queued.
 */
export function serveWorker(
  endpoint: Endpoint,
  loadServer: () => Promise<ServerExports>,
  scope: Scope,
  store: SaveStore,
): void {
  const send = (m: ToPage) => endpoint.postMessage(m);
  const event = (name: string, detail: string) => send({ k: 'event', name, detail });
  // Saves in flight: the names asked for, and the bytes of the one the Engine has made.
  const names: string[] = [];
  let bytes: Uint8Array | null = null;
  // Globals WorkerMain calls.
  scope.fcPost = (xml: string) => send({ k: 'fc', xml });
  scope.fcSaved = (b: Int8Array) => {
    bytes = Uint8Array.from(new Uint8Array(b.buffer, b.byteOffset, b.length)); // a copy: the Engine's memory moves on
  };
  scope.fcServerEvent = (name: string, detail: string) => {
    if (name !== 'saved') {
      // The Engine could not save: that save's name is done with.
      if (name === 'saveFailed') names.shift();
      return event(name, detail);
    }
    // The Engine has saved: keep the bytes with what the list shows, in one transaction.
    const mine = bytes;
    bytes = null;
    const wanted = names.shift() ?? '';
    store
      .put(newSave(JSON.parse(detail) as SavedInfo, wanted, Date.now()), mine!)
      .then((meta) => event('saved', JSON.stringify(meta)))
      .catch((ex: unknown) => event('saveFailed', describe(ex)));
  };

  let server: ServerExports | null = null;
  const queued: ToWorker[] = [];
  let gotData: (m: { data: string[]; language: string }) => void;
  const data = new Promise<{ data: string[]; language: string }>((ok) => (gotData = ok));

  const handle = (m: ToWorker) => {
    switch (m.k) {
      case 'start':
        return server!.startGame(m.rules, m.preset);
      case 'save':
        names.push(m.name);
        return server!.saveGame(m.active);
      case 'load':
        return void store
          .get(m.id)
          .then((b) => {
            if (!b) return event('loadFailed', `no save ${m.id}`);
            server!.loadGame(new Int8Array(b.buffer, b.byteOffset, b.length));
          })
          .catch((ex: unknown) => event('loadFailed', describe(ex)));
      case 'debug':
        return server!.debug(m.request);
      case 'setup':
        return server!.setup();
      case 'connect':
        return server!.connect();
      case 'fc':
        return server!.receive(m.xml);
    }
  };
  listen<ToWorker>(endpoint, (m) => {
    if (m.k === 'data') gotData(m);
    else if (server) handle(m);
    else queued.push(m);
  });

  void (async () => {
    try {
      const [exports, bundle] = await Promise.all([loadServer(), data]);
      exports.setLanguage(bundle.language);
      exports.main(bundle.data);
      server = exports;
      for (const m of queued.splice(0)) handle(m);
    } catch (ex) {
      send({ k: 'event', name: 'failed', detail: 'worker load: ' + describe(ex) });
    }
  })();
}

export interface PageOptions {
  worker: Endpoint;
  loadClient: () => Promise<ClientExports>;
  /** The data bundle: alternating "data/<path>" and file text, with the language's strings files. */
  data: string[];
  /** The language of FreeCol's text, a translation's id (language.ts), for both Engines. */
  language: string;
  rules: string;
  /** A saved game's id to load in place of a new game. */
  load?: number;
  /** The JSON of a GamePreset (options, nation, map seed) to start from, or "" for none. */
  preset?: string;
  /** Rounds the human player auto-ends before play is handed to them. */
  autoplay: number;
  scope: Scope;
  /** Every event from either Engine: ready, gameStarted, round, map, finished, failed, ... */
  onEvent: (name: string, detail: string) => void;
  /** What the WebGUI shows and asks. */
  gui: GuiHandlers;
}

/**
 * Page side: hand the data bundle to the Worker, load the client module and
 * run a game: once the client is ready the Worker starts the server, then
 * the client logs in and plays `autoplay` rounds. Resolves to the client
 * module once it has loaded, for the player's commands.
 */
export function startPage(o: PageOptions): Promise<ClientExports> {
  const send = (m: ToWorker) => o.worker.postMessage(m);
  let client: ClientExports | null = null;
  let setupAsked = false;

  // Globals ClientMain calls.
  o.scope.fcToServer = (xml: string) => send({ k: 'fc', xml });
  o.scope.fcConnect = () => send({ k: 'connect' });
  o.scope.fcClientEvent = (name: string, detail: string) => {
    if (name === 'ready')
      send(o.load === undefined ? { k: 'start', rules: o.rules, preset: o.preset ?? '' } : { k: 'load', id: o.load });
    // A new game's preset may set up the game state, once the game has started.
    if (name === 'gameStarted' && o.load === undefined && !setupAsked) {
      setupAsked = true;
      send({ k: 'setup' });
    }
    o.onEvent(name, detail);
  };
  Object.assign(
    o.scope,
    webGui(o.gui, (id, value) => client!.answer(id, value)),
  );

  let owner = '';
  listen<ToPage>(o.worker, (m) => {
    if (m.k === 'fc') return client!.receive(m.xml);
    if (m.name === 'debug') client!.debugApplied(m.detail);
    if (m.name === 'started') client!.startGame(o.autoplay, '');
    // The owner of a loaded game, which the client must log in as, comes just before "loaded".
    if (m.name === 'owner') owner = m.detail;
    // A loaded game goes on where it stopped, with no autoplay.
    if (m.name === 'loaded') client!.startGame(0, owner);
    o.onEvent(m.name, m.detail);
  });

  send({ k: 'data', data: o.data, language: o.language });
  const loaded = o.loadClient().then((exports) => {
    client = exports;
    client.setLanguage(o.language);
    client.main(o.data); // returns at once; 'ready' arrives as an event
    return exports;
  });
  loaded.catch((ex: unknown) => o.onEvent('failed', 'client load: ' + describe(ex)));
  return loaded;
}
