// Module Worker: hosts the server Engine (server.wasm) and keeps the saved games.
import runtimeUrl from '../generated/teavm-runtime.js?url';
import serverUrl from '../generated/server.wasm?url';
import { serveWorker, type Endpoint, type Scope, type ServerExports } from './channel';
import { idbSaveStore, keepSaves } from './saves';
import { loadModule } from './teavm';

// Ask the browser not to evict our saves when disk runs low. It may refuse.
void keepSaves(navigator.storage);

serveWorker(
  self as unknown as Endpoint,
  () => loadModule<ServerExports>(runtimeUrl, serverUrl),
  globalThis as unknown as Scope,
  idbSaveStore(),
);
