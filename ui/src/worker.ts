// Module Worker: hosts the server Engine (server.wasm) and keeps the saved games.
import runtimeUrl from '../generated/teavm-runtime.js?url';
import serverUrl from '../generated/server.wasm?url';
import { serveWorker, type Endpoint, type Scope, type ServerExports } from './channel';
import { idbSaveStore } from './saves';
import { captureConsole } from './log-buffer';
import { loadModule } from './teavm';

// Keep what the Engine logs to this console, for the error dialog's log.
const log = captureConsole(console);

serveWorker(
  self as unknown as Endpoint,
  () => loadModule<ServerExports>(runtimeUrl, serverUrl),
  globalThis as unknown as Scope,
  idbSaveStore(),
  log,
);
