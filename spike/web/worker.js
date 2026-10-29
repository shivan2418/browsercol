// Web Worker: hosts the server Engine (server.wasm). Talks to main.js with
//   page -> worker: {k:'start', rules} | {k:'connect'} | {k:'fc', xml} | {k:'stats'}
//   worker -> page: {k:'fc', xml} | {k:'event', name, detail} | {k:'stats', ...}
// Classic worker, so the TeaVM runtime comes in with importScripts.
const t0 = performance.now();
const stats = { inMsgs: 0, inBytes: 0, outMsgs: 0, outBytes: 0 };
const utf8 = new TextEncoder();
let exports = null;
let queued = [];   // page messages that arrive while the module still loads

// Globals the Java side (WorkerMain) calls.
globalThis.fcPost = xml => {
  stats.outMsgs++; stats.outBytes += utf8.encode(xml).length;
  postMessage({ k: 'fc', xml });
};
globalThis.fcServerEvent = (name, detail) => postMessage({ k: 'event', name, detail });

function handle(m) {
  switch (m.k) {
    case 'start': exports.startGame(m.rules); break;
    case 'connect': exports.connect(); break;
    case 'fc':
      stats.inMsgs++; stats.inBytes += utf8.encode(m.xml).length;
      exports.receive(m.xml);
      break;
    case 'stats': postMessage({ k: 'stats', ...stats }); break;
  }
}
onmessage = e => exports ? handle(e.data) : queued.push(e.data);

(async () => {
  try {
    const td = performance.now();
    const data = await (await fetch('data.json')).json();
    const dataMs = performance.now() - td;
    importScripts('server.wasm-runtime.js');
    const tw = performance.now();
    const teavm = await globalThis.TeaVM.wasmGC.load('server.wasm');
    const wasmMs = performance.now() - tw;
    exports = teavm.exports;
    postMessage({ k: 'event', name: 'loaded', detail: JSON.stringify({ dataMs, wasmMs, sinceStartMs: performance.now() - t0 }) });
    exports.main(data);
    for (const m of queued) handle(m);
    queued = [];
  } catch (ex) {
    postMessage({ k: 'event', name: 'failed', detail: 'worker load: ' + (ex && ex.stack || ex) });
  }
})();
