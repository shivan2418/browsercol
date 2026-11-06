// Runs the split Engine under Node, as the browser will: the server module
// in a worker thread, the client module on the main thread, joined only by
// protocol XML strings over postMessage.
//   node run-split-node.mjs [rounds] [--verbose] [--save]
//   node run-split-node.mjs --load <file.fsg>
// --save: after the rounds, the server Engine saves the game, loads the
// save in place of the game and saves again; both saves are written to
// ../.cache/saves. --load: the server Engine loads a savegame, e.g. one
// desktop FreeCol wrote, and saves it again beside the others. (#67)
// Expects to be run from engine/ after building both modules:
//   gradle generateWasmGC copyWasmGCRuntime -Pmain=browsercol.web.WorkerMain -Pout=server
//   gradle generateWasmGC copyWasmGCRuntime -Pmain=browsercol.web.ClientMain -Pout=client
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const out = 'build/generated/teavm';
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
  createRequire(import.meta.url)(path.resolve(`${out}/${name}/${name}.wasm-runtime.js`));
  const t = performance.now();
  const teavm = await globalThis.TeaVM.wasmGC.load(path.resolve(`${out}/${name}/${name}.wasm`));
  log(`${name}.wasm loaded in ${(performance.now() - t).toFixed(0)}ms`);
  return teavm.exports;
}

/**
 * The answers the runner gives the WebGUI's questions, one per kind, as
 * the strings the Engine expects (ui/src/webgui.ts): "true" for a confirm,
 * the index of a choice, the text of an input. They are the defaults a
 * player would give, as the Browser UI takes them when the player presses
 * Enter (ui/src/panels.tsx) or its auto-player clicks (ui/scripts/dialogs.ts).
 */
const answers = {
  /**
   * A confirm: the dialog's default button, which keeps the game going
   * (the end turn dialog's default ends the turn, the victory dialog's
   * continues playing), except when the question is about going to
   * Europe: nothing is sent there on its own.
   */
  confirm: (ask) => (/Europe/.test(ask.text ?? '')
    ? 'false'
    : ask.defaultOk && ask.ok !== null ? 'true' : 'false'),
  /**
   * A choice: FreeCol's default choice, the one Enter takes (the Browser
   * UI's panels.tsx), else the first enabled one.
   */
  choice: (ask) => {
    const choices = Array.isArray(ask.choices) ? ask.choices : [];
    const usable = choices.map((c, i) => (c.enabled === false ? -1 : i)).filter((i) => i >= 0);
    if (usable.length === 0) return null;
    const byDefault = usable.find((i) => choices[i].default);
    return String(byDefault ?? usable[0]);
  },
  /**
   * An input: the text the dialog offers, which OK accepts.
   */
  input: (ask) => (typeof ask.value === 'string' ? ask.value : ''),
};

if (isMainThread) {
  const args = process.argv.slice(2);
  const rounds = Number(args.find((a) => !a.startsWith('-')) ?? 5);
  const verbose = args.includes('--verbose') || process.env.FC_VERBOSE === '1';
  const save = args.includes('--save');
  const loadFrom = args.includes('--load') ? args[args.indexOf('--load') + 1] : null;
  const worker = new Worker(new URL(import.meta.url));
  // Savegames from the Worker: the first is loaded back, the second ends
  // the run. A --load run saves once and ends.
  const saves = [];
  const saveDir = '../.cache/saves';
  const writeSave = (bytes) => {
    fs.mkdirSync(saveDir, { recursive: true });
    const name = loadFrom
      ? `${saveDir}/${path.basename(loadFrom, '.fsg')}-resaved.fsg`
      : `${saveDir}/split-${saves.length}.fsg`;
    fs.writeFileSync(name, bytes);
    log(`wrote ${name}: ${bytes.length} bytes`);
  };
  // Per round: messages and characters in each direction.
  const traffic = { up: [0, 0], down: [0, 0] };
  const count = (dir, xml) => { traffic[dir][0]++; traffic[dir][1] += xml.length; };
  let client;
  globalThis.fcToServer = (xml) => { count('up', xml); worker.postMessage({ k: 'fc', xml }); };
  globalThis.fcConnect = () => worker.postMessage({ k: 'connect' });
  // The WebGUI's globals for the client Engine, as the Browser UI defines
  // them (ui/src/webgui.ts): fcShow(kind, json) for an event, fcAsk(id,
  // kind, json) for a question, whose answer goes back through the client
  // module's answer(id, value) export. The runner has no player, so it
  // answers every question with the default for its kind.
  const unknownKinds = new Set();
  globalThis.fcShow = (kind, json) => {
    if (!verbose) return;
    try {
      log(`show ${kind}: ${json}`);
    } catch (ex) {
      // An event must never break the game.
    }
  };
  globalThis.fcAsk = (id, kind, json) => {
    let value = null;
    try {
      const ask = JSON.parse(json);
      const answer = Object.hasOwn(answers, kind) ? answers[kind] : undefined;
      if (answer === undefined) {
        // A kind the runner does not know: say so once, and answer as
        // closed, as the Browser UI does.
        if (!unknownKinds.has(kind)) {
          unknownKinds.add(kind);
          log(`unknown question kind ${kind}; answering as closed`);
        }
      } else {
        value = answer(ask);
        if (verbose) log(`asked ${kind}: ${json} -> ${value}`);
      }
    } catch (ex) {
      // A question must never break the game: answer as closed.
      value = null;
    }
    // Answer in a later microtask, as the Browser UI does: never inside
    // the Engine's call. The Engine's wait suspends its thread, which
    // lets the Node event loop run the microtask.
    queueMicrotask(() => {
      try {
        client.answer(id, value);
      } catch (ex) {
        log(`answer ${id} failed: ${ex}`);
      }
    });
  };
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
      if (save) worker.postMessage({ k: 'save' });
      else process.exit(0);
      break;
    default:
      log(`${name}: ${detail}`);
      if (name === 'failed') process.exit(1);
    }
  };
  worker.on('message', (m) => {
    if (m.k === 'fc') { count('down', m.xml); client.receive(m.xml); }
    else if (m.k === 'saved') {
      saves.push(m.bytes);
      writeSave(m.bytes);
    } else if (m.k === 'event') {
      log(`server ${m.name}: ${m.detail}`);
      if (m.name === 'started') client.startGame(rounds);
      if (m.name === 'failed') process.exit(1);
      if (m.name === 'ready' && loadFrom) {
        worker.postMessage({ k: 'load', bytes: new Uint8Array(fs.readFileSync(loadFrom)) });
      }
      if (m.name === 'loaded') worker.postMessage({ k: 'save' });
      if (m.name === 'saved') {
        if (loadFrom || saves.length >= 2) process.exit(0);
        worker.postMessage({ k: 'load', bytes: saves[0] });
      }
    }
  });
  worker.on('error', (e) => { log(`worker error ${e}`); process.exit(1); });
  if (!loadFrom) {
    client = await load('client');
    client.main(dataArgs());
  }
} else {
  globalThis.fcPost = (xml) => parentPort.postMessage({ k: 'fc', xml });
  globalThis.fcServerEvent = (name, detail) => parentPort.postMessage({ k: 'event', name, detail });
  globalThis.fcSaved = (bytes) => parentPort.postMessage({ k: 'saved', bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) });
  const server = await load('server');
  server.main(dataArgs());
  parentPort.postMessage({ k: 'event', name: 'ready', detail: '' });
  parentPort.on('message', (m) => {
    if (m.k === 'start') server.startGame(m.rules, '', new Int8Array(0));
    else if (m.k === 'save') server.saveGame('');
    else if (m.k === 'load') server.loadGame(new Int8Array(m.bytes.buffer, m.bytes.byteOffset, m.bytes.length));
    else if (m.k === 'connect') server.connect();
    else if (m.k === 'fc') server.receive(m.xml);
  });
}
