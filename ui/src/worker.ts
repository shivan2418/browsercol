// Module Worker: hosts the server Engine (server.wasm).
import runtimeUrl from '../generated/teavm-runtime.js?url';
import serverUrl from '../generated/server.wasm?url';
import { serveWorker, type Endpoint, type Scope, type ServerExports } from './channel';
import { loadModule } from './teavm';

serveWorker(
  self as unknown as Endpoint,
  () => loadModule<ServerExports>(runtimeUrl, serverUrl),
  globalThis as unknown as Scope,
);
