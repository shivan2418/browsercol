// The postMessage routing between the page, which hosts the client Engine
// (client.wasm), and the Worker, which hosts the server Engine (server.wasm).
//   page -> worker: data (the bundle, once) | start | connect | fc
//   worker -> page: fc | event
// The page fetches the data bundle and hands it over, so it is downloaded once.
// The client Engine's WebGUI talks to the page alone, through webgui.ts.
import { webGui, type GuiHandlers } from './webgui';

/** Exports of the server module (online.freecol.web.WorkerMain). */
export interface ServerExports {
  main(args: string[]): void;
  startGame(rules: string): void;
  connect(): void;
  receive(xml: string): void;
}

/** Exports of the client module (online.freecol.web.ClientMain). */
export interface ClientExports {
  main(args: string[]): void;
  startGame(rounds: number): void;
  receive(xml: string): void;
  /** Answer a WebGUI question; null for a closed dialog. */
  answer(id: number, value: string | null): void;
}

export type ToWorker =
  | { k: 'data'; data: string[] }
  | { k: 'start'; rules: string }
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
export function serveWorker(endpoint: Endpoint, loadServer: () => Promise<ServerExports>, scope: Scope): void {
  const send = (m: ToPage) => endpoint.postMessage(m);
  // Globals WorkerMain calls.
  scope.fcPost = (xml: string) => send({ k: 'fc', xml });
  scope.fcServerEvent = (name: string, detail: string) => send({ k: 'event', name, detail });

  let server: ServerExports | null = null;
  const queued: ToWorker[] = [];
  let gotData: (data: string[]) => void;
  const data = new Promise<string[]>((ok) => (gotData = ok));

  const handle = (m: ToWorker) => {
    switch (m.k) {
      case 'start':
        return server!.startGame(m.rules);
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
  /** Rounds the human player auto-ends before the game finishes. */
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
 * the client logs in and plays `autoplay` rounds.
 */
export function startPage(o: PageOptions): void {
  const send = (m: ToWorker) => o.worker.postMessage(m);
  let client: ClientExports | null = null;

  // Globals ClientMain calls.
  o.scope.fcToServer = (xml: string) => send({ k: 'fc', xml });
  o.scope.fcConnect = () => send({ k: 'connect' });
  o.scope.fcClientEvent = (name: string, detail: string) => {
    if (name === 'ready') send({ k: 'start', rules: o.rules });
    o.onEvent(name, detail);
  };
  Object.assign(
    o.scope,
    webGui(o.gui, (id, value) => client!.answer(id, value)),
  );

  listen<ToPage>(o.worker, (m) => {
    if (m.k === 'fc') return client!.receive(m.xml);
    if (m.name === 'started') client!.startGame(o.autoplay);
    o.onEvent(m.name, m.detail);
  });

  send({ k: 'data', data: o.data });
  void (async () => {
    try {
      client = await o.loadClient();
      client.main(o.data); // returns at once; 'ready' arrives as an event
    } catch (ex) {
      o.onEvent('failed', 'client load: ' + describe(ex));
    }
  })();
}
