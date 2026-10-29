// Page script: hosts the client Engine (client.wasm) on the main thread, the
// server Engine in worker.js, and draws the map. Records timings and message
// volume into window.spikeResult once the game finishes or fails.
const params = new URLSearchParams(location.search);
const rounds = parseInt(params.get('rounds') ?? '10', 10);
const drawMaps = params.get('draw') !== '0';   // ?draw=0: no map drawing, to measure its cost
// Milestones count from navigation start, so they include loading the page and PixiJS.
const now = () => performance.now();
const utf8 = new TextEncoder();
const out = document.getElementById('out');

const timings = {};            // milestone name -> ms since page start
const roundStats = [];         // per round: ms (AI time) and message traffic
let bucket = newBucket();      // traffic since the last milestone
const total = newBucket();
let workerStats = null;
let finished = false;

function newBucket() { return { toServerMsgs: 0, toServerBytes: 0, toClientMsgs: 0, toClientBytes: 0, drawMs: 0 }; }
function count(b, dir, xml) {
  b[dir + 'Msgs']++; b[dir + 'Bytes'] += utf8.encode(xml).length;
}
function traffic(dir, xml) { count(bucket, dir, xml); count(total, dir, xml); }

const worker = new Worker('worker.js');
let client = null;

// ---- Globals the Java side (ClientMain) calls ----
globalThis.fcToServer = xml => { traffic('toServer', xml); worker.postMessage({ k: 'fc', xml }); };
globalThis.fcConnect = () => worker.postMessage({ k: 'connect' });
globalThis.fcClientEvent = (name, detail) => {
  switch (name) {
    case 'ready':
      timings.clientReady = now();
      worker.postMessage({ k: 'start', rules: 'classic' });
      break;
    case 'gameStarted':
      timings.gameStarted = now();
      roundStats.push({ round: 0, label: 'setup', ms: 0, ...bucket }); bucket = newBucket();
      draw(JSON.parse(detail));
      break;
    case 'round': {
      const [n, ms] = detail.split(',').map(Number);
      roundStats.push({ round: n, ms, ...bucket }); bucket = newBucket();
      break;
    }
    case 'map': draw(JSON.parse(detail)); break;
    case 'finished': finish('finished', { turn: detail }); break;
    case 'failed': finish('failed', { error: detail }); break;
  }
  render();
};

// ---- Worker messages ----
worker.onmessage = e => {
  const m = e.data;
  if (m.k === 'fc') { traffic('toClient', m.xml); client.receive(m.xml); }
  else if (m.k === 'stats') workerStats = m;
  else if (m.k === 'event') {
    switch (m.name) {
      case 'loaded': timings.worker = JSON.parse(m.detail); break;
      case 'started':
        timings.serverStarted = now();
        timings.serverReportedMs = Number(m.detail);
        client.startGame(rounds);
        break;
      case 'failed': finish('failed', { error: m.detail }); break;
    }
    render();
  }
};
worker.onerror = e => finish('failed', { error: `worker error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}` });

async function finish(status, extra) {
  if (finished) return;
  finished = true;
  timings.total = now();
  // Ask the worker for its own counters; do not wait long if it is wedged.
  const got = new Promise(r => { const f = e => { if (e.data.k === 'stats') { worker.removeEventListener('message', f); r(); } }; worker.addEventListener('message', f); });
  worker.postMessage({ k: 'stats' });
  await Promise.race([got, new Promise(r => setTimeout(r, 2000))]);
  if (bucket.toServerMsgs || bucket.toClientMsgs) roundStats.push({ round: -1, label: 'after last round', ms: 0, ...bucket });
  window.spikeResult = {
    status, ...extra, rounds, drawMaps, userAgent: navigator.userAgent, renderer,
    timings, roundStats, total, workerStats,
    dataFiles: dataFileCount,
  };
  render();
  // For browsers launched without Playwright (bare-run.mjs).
  fetch('result', { method: 'POST', body: JSON.stringify(window.spikeResult) }).catch(() => {});
}

let renderer = 'none', dataFileCount = 0;
function render() {
  out.textContent = JSON.stringify(window.spikeResult ?? { status: 'running', timings, roundStats, total }, null, 1);
}

// ---- Load the client module ----
(async () => {
  try {
    const td = performance.now();
    const data = await (await fetch('data.json')).json();
    dataFileCount = data.length / 2;
    timings.dataFetchMs = performance.now() - td;
    await new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'client.wasm-runtime.js'; s.onload = ok; s.onerror = () => no(new Error('runtime'));
      document.head.append(s);
    });
    const tw = performance.now();
    const teavm = await TeaVM.wasmGC.load('client.wasm');
    timings.clientWasmMs = performance.now() - tw;
    client = teavm.exports;
    client.main(data);   // returns at once; 'ready' arrives as an event
  } catch (ex) {
    finish('failed', { error: 'client load: ' + (ex && ex.stack || ex) });
  }
})();

// ---- Crude map renderer ----
// Colour per tile type id, matched on the last segment of the id.
const COLORS = [
  [/highSeas|deepOcean/i, 0x0a2a6b], [/ocean/i, 0x1f5fbf], [/lake/i, 0x4f8fdf],
  [/plains/i, 0xc9b458], [/grassland/i, 0x5fa83a], [/prairie/i, 0x9cc45a], [/savannah/i, 0xb7a93f],
  [/marsh/i, 0x6f8f5f], [/swamp/i, 0x4a6b4a], [/desert/i, 0xe0c88a], [/tundra/i, 0xb8c0b0],
  [/arctic/i, 0xf4f8ff],
  [/coniferForest|boreal/i, 0x1f5a2f], [/scrubForest/i, 0x6f7f35], [/tropicalForest|rain/i, 0x0f6f2f],
  [/forest/i, 0x2f7f3f], [/hills/i, 0x8f7050], [/mountains/i, 0x777777],
];
const colorOf = id => { for (const [re, c] of COLORS) if (re.test(id)) return c; return 0x888888; };
const css = c => '#' + c.toString(16).padStart(6, '0');

let pixi = null, ctx2d = null, size = 8;
async function initRenderer(map) {
  size = Math.max(2, Math.floor(Math.min(900 / map.w, 700 / map.h)));
  const w = map.w * size, h = map.h * size, host = document.getElementById('map');
  try {
    const app = new PIXI.Application();
    await app.init({ width: w, height: h, background: 0x000000, antialias: false });
    host.append(app.canvas);
    pixi = new PIXI.Graphics(); app.stage.addChild(pixi);
    renderer = 'pixi:' + (app.renderer.name ?? 'unknown');
  } catch (ex) {
    // No WebGL (some headless builds): fall back to Canvas 2D so the run still measures.
    const c = document.createElement('canvas'); c.width = w; c.height = h; host.append(c);
    ctx2d = c.getContext('2d'); pixi = null; renderer = 'canvas2d (pixi failed: ' + ex.message + ')';
  }
}

let drawing = Promise.resolve();   // serialises draws behind the async init
function draw(map) {
  if (!drawMaps) return;
  drawing = drawing.then(async () => {
    const t = performance.now();
    await drawNow(map);
    bucket.drawMs += performance.now() - t;
  });
}
async function drawNow(map) {
  if (!pixi && !ctx2d) await initRenderer(map);
  const s = size, cols = map.types.map(colorOf);
  const rect = (x, y, w, h, c, stroke) => {
    if (pixi) { pixi.rect(x, y, w, h); stroke ? pixi.stroke({ width: 1, color: stroke }) : pixi.fill(c); }
    else { ctx2d.fillStyle = css(c); ctx2d.fillRect(x, y, w, h); }
  };
  if (pixi) pixi.clear(); else ctx2d.clearRect(0, 0, map.w * s, map.h * s);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const ch = map.tiles.charCodeAt(y * map.w + x) - 65;
      rect(x * s, y * s, s, s, ch >= 0 ? cols[ch] : 0x000000);
    }
  for (const [x, y, rgb] of map.settlements) {
    rect(x * s, y * s, s, s, rgb);
    if (pixi) { pixi.rect(x * s + .5, y * s + .5, s - 1, s - 1); pixi.stroke({ width: 1, color: 0xffffff }); }
    else { ctx2d.strokeStyle = '#fff'; ctx2d.strokeRect(x * s + .5, y * s + .5, s - 1, s - 1); }
  }
  for (const [x, y, rgb] of map.units) {
    if (pixi) { pixi.circle(x * s + s / 2, y * s + s / 2, Math.max(1.5, s / 3)); pixi.fill(rgb); }
    else { ctx2d.fillStyle = css(rgb); ctx2d.beginPath(); ctx2d.arc(x * s + s / 2, y * s + s / 2, Math.max(1.5, s / 3), 0, 7); ctx2d.fill(); }
  }
}
