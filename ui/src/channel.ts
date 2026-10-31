// The postMessage routing between the page, which hosts the client Engine
// (client.wasm), and the Worker, which hosts the server Engine (server.wasm).
//   page -> worker: data (the bundle, once) | start | load | save | connect | fc
//   worker -> page: fc | event
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
  main(args: string[]): void;
  startGame(rules: string): void;
  /** Save the game; the bytes go out through fcSaved and then a "saved" event. */
  saveGame(activeUnitId: string): void;
  /** Replace the game with the one in a savegame; a "loaded" event follows. */
  loadGame(savegame: Int8Array): void;
  connect(): void;
  receive(xml: string): void;
}

/** Exports of the client module (online.freecol.web.ClientMain). */
export interface ClientExports {
  main(args: string[]): void;
  /** Log in as `name` (a loaded game's owner; empty for a new game) and play `rounds` rounds. */
  startGame(rounds: number, name: string): void;
  /** The id of the active unit, or "" for none: what a save request carries. */
  activeUnitId(): string;
  receive(xml: string): void;
  /** Answer a WebGUI question; null for a closed dialog. */
  answer(id: number, value: string | null): void;
  // Player commands (Commands.java). Each returns at once and sends a "map"
  // event when done; input while one runs is dropped.
  /** Select our unit on a tile, or send the active unit there. */
  click(x: number, y: number): void;
  /** Move the active unit one step; a FreeCol Direction name, e.g. "NE". */
  move(direction: string): void;
  nextUnit(): void;
  buildColony(): void;
  endTurn(): void;
  /** Declare independence (DeclareIndependenceAction). */
  declareIndependence(): void;
  /** The standing orders of the active unit. */
  fortify(): void;
  sentry(): void;
  skip(): void;
  disband(): void;
  plow(): void;
  clearForest(): void;
  road(): void;
  /** Send the active unit to a destination; the player is asked where. */
  selectDestination(): void;
}

export type ToWorker =
  | { k: 'data'; data: string[] }
  | { k: 'start'; rules: string }
  | { k: 'load'; id: number }
  | { k: 'save'; active: string; name: string }
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
    if (name !== 'saved') return event(name, detail);
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
  let gotData: (data: string[]) => void;
  const data = new Promise<string[]>((ok) => (gotData = ok));

  const handle = (m: ToWorker) => {
    switch (m.k) {
      case 'start':
        return server!.startGame(m.rules);
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
      case 'connect':
        return server!.connect();
      case 'fc':
        return server!.receive(m.xml);
    }
  };
  listen<ToWorker>(endpoint, (m) => {
    if (m.k === 'data') gotData(m.data);
    else if (server) handle(m);
    else queued.push(m);
  });

  void (async () => {
    try {
      const [exports, args] = await Promise.all([loadServer(), data]);
      exports.main(args);
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
  /** The data bundle: alternating "data/<path>" and file text. */
  data: string[];
  rules: string;
  /** A saved game's id to load in place of a new game. */
  load?: number;
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

  // Globals ClientMain calls.
  o.scope.fcToServer = (xml: string) => send({ k: 'fc', xml });
  o.scope.fcConnect = () => send({ k: 'connect' });
  o.scope.fcClientEvent = (name: string, detail: string) => {
    if (name === 'ready') send(o.load === undefined ? { k: 'start', rules: o.rules } : { k: 'load', id: o.load });
    o.onEvent(name, detail);
  };
  Object.assign(
    o.scope,
    webGui(o.gui, (id, value) => client!.answer(id, value)),
  );

  let owner = '';
  listen<ToPage>(o.worker, (m) => {
    if (m.k === 'fc') return client!.receive(m.xml);
    if (m.name === 'started') client!.startGame(o.autoplay, '');
    // The owner of a loaded game, which the client must log in as, comes just before "loaded".
    if (m.name === 'owner') owner = m.detail;
    // A loaded game goes on where it stopped, with no autoplay.
    if (m.name === 'loaded') client!.startGame(0, owner);
    o.onEvent(m.name, m.detail);
  });

  send({ k: 'data', data: o.data });
  const loaded = o.loadClient().then((exports) => {
    client = exports;
    client.main(o.data); // returns at once; 'ready' arrives as an event
    return exports;
  });
  loaded.catch((ex: unknown) => o.onEvent('failed', 'client load: ' + describe(ex)));
  return loaded;
}
