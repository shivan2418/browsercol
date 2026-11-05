// Module Worker: hosts the server Engine (server.wasm) and keeps the saved games.
import runtimeUrl from '../generated/teavm-runtime.js?url';
import serverUrl from '../generated/server.wasm?url';
import { serveWorker, type Endpoint, type Scope, type ServerExports } from './channel';
import { idbSaveStore, keepSaves } from './saves';
import { captureConsole } from './log-buffer';
import { loadModule } from './teavm';

// Keep what the Engine logs to this console, for the error dialog's log.
const log = captureConsole(console);

// Ask the browser not to evict our saves when disk runs low. It may refuse.
void keepSaves(navigator.storage);

serveWorker(
  self as unknown as Endpoint,
  () => loadModule<ServerExports>(runtimeUrl, serverUrl),
  globalThis as unknown as Scope,
  idbSaveStore(),
  log,
);
