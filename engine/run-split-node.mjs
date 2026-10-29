// Runs the split Engine under Node, as the browser will: the server module
// in a worker thread, the client module on the main thread, joined only by
// protocol XML strings over postMessage.
//   node run-split-node.mjs [rounds]
// Expects to be run from engine/ after building both modules:
//   gradle generateWasmGC copyWasmGCRuntime -Pmain=online.freecol.web.WorkerMain -Pout=server
//   gradle generateWasmGC copyWasmGCRuntime -Pmain=online.freecol.web.ClientMain -Pout=client
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const out = 'build/generated/teavm/wasm-gc';
const data = '../freecol/data';
const t0 = performance.now();
const log = (s) => console.error(`[${isMainThread ? 'client' : 'server'} ${(performance.now() - t0).toFixed(0)}ms] ${s}`);

function dataArgs() {
  const files = [
    'base/client-options.xml',
    'base/roles-compat.xml',
    'base/unit-change-types-compat.xml',
    'strings/FreeColMessages.properties',
    'strings/plurals.xml',
    ...fs.readdirSync(`${data}/rules`, { recursive: true })
      .map(f => `rules/${f}`)
      .filter(f => fs.statSync(`${data}/${f}`).isFile()),
  ];
  return files.flatMap(f => [`data/${f}`, fs.readFileSync(`${data}/${f}`, 'utf8')]);
}

async function load(name) {
  createRequire(import.meta.url)(path.resolve(`${out}/${name}.wasm-runtime.js`));
  const t = performance.now();
  const teavm = await globalThis.TeaVM.wasmGC.load(path.resolve(`${out}/${name}.wasm`));
  log(`${name}.wasm loaded in ${(performance.now() - t).toFixed(0)}ms`);
  return teavm.exports;
}

if (isMainThread) {
  const rounds = Number(process.argv[2] ?? 5);
  const worker = new Worker(new URL(import.meta.url));
  // Per round: messages and characters in each direction.
  const traffic = { up: [0, 0], down: [0, 0] };
  const count = (dir, xml) => { traffic[dir][0]++; traffic[dir][1] += xml.length; };
  let client;
  globalThis.fcToServer = (xml) => { count('up', xml); worker.postMessage({ k: 'fc', xml }); };
  globalThis.fcConnect = () => worker.postMessage({ k: 'connect' });
  globalThis.fcClientEvent = (name, detail) => {
    switch (name) {
    case 'ready':
      log('client ready, starting server game');
      worker.postMessage({ k: 'start', rules: 'classic' });
      break;
    case 'gameStarted': {
      const map = JSON.parse(detail);
      log(`game started: map ${map.w}x${map.h}, ${map.turn}; setup traffic up ${traffic.up}, down ${traffic.down}`);
      traffic.up = [0, 0]; traffic.down = [0, 0];
      break;
    }
    case 'round': {
      const [n, ms] = detail.split(',');
      log(`round ${n} AI took ${ms}ms; up ${traffic.up[0]} msgs ${traffic.up[1]} chars, down ${traffic.down[0]} msgs ${traffic.down[1]} chars`);
      traffic.up = [0, 0]; traffic.down = [0, 0];
      break;
    }
    case 'map': break;
    case 'finished':
      log(`finished at ${detail}`);
      process.exit(0);
    default:
      log(`${name}: ${detail}`);
      if (name === 'failed') process.exit(1);
    }
  };
  worker.on('message', (m) => {
    if (m.k === 'fc') { count('down', m.xml); client.receive(m.xml); }
    else if (m.k === 'event') {
      log(`server ${m.name}: ${m.detail}`);
      if (m.name === 'started') client.startGame(rounds);
      if (m.name === 'failed') process.exit(1);
    }
  });
  worker.on('error', (e) => { log(`worker error ${e}`); process.exit(1); });
  client = await load('client');
  client.main(dataArgs());
} else {
  globalThis.fcPost = (xml) => parentPort.postMessage({ k: 'fc', xml });
  globalThis.fcServerEvent = (name, detail) => parentPort.postMessage({ k: 'event', name, detail });
  const server = await load('server');
  server.main(dataArgs());
  parentPort.on('message', (m) => {
    if (m.k === 'start') server.startGame(m.rules);
    else if (m.k === 'connect') server.connect();
    else if (m.k === 'fc') server.receive(m.xml);
  });
}
