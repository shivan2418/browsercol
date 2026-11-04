// Profiles the built site in Chromium while the player pans, zooms, edge-scrolls,
// moves a unit and ends turns. For each phase it prints the frame times the page
// saw (requestAnimationFrame intervals), the long tasks (>50 ms) and the CPU time
// per thread, then the functions with the most self time over the whole run,
// per thread (page and Engine worker). The raw trace is kept in .cache/perf/ to
// open in DevTools (Performance > Load profile) or ui.perfetto.dev.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/perf.mjs [--query renderer=canvas2d] [--turns 5] [--top 25]
import fs from 'node:fs';
import path from 'node:path';
import { opt, playwright, waitForResult } from './common.mjs';
import { answerDialogs } from './dialogs.mjs';
import { serveDist } from './serve-dist.mjs';

const query = opt('query', '');
const turns = Number(opt('turns', '5'));
const top = Number(opt('top', '25'));
const out = path.resolve(import.meta.dirname, '../../.cache/perf');
fs.mkdirSync(out, { recursive: true });

const server = await serveDist();
// --gpu draws on a real GPU (the container needs it: docker run --device /dev/dri/renderDNNN), not SwiftShader.
const gpu = process.argv.includes('--gpu');
const browser = await playwright.chromium.launch(
  gpu
    ? {
        channel: 'chromium',
        args: [
          '--use-gl=angle',
          '--use-angle=gl-egl',
          '--ignore-gpu-blocklist',
          '--enable-gpu',
          '--enable-gpu-rasterization',
        ],
      }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await answerDialogs(page);
page.on('pageerror', (e) => console.log(`page error: ${e}`));

// --quality N sets FreeCol's graphics quality before the page loads (below 20 draws without antialiasing).
const quality = opt('quality', '');
if (quality) {
  await page.addInitScript((q) => {
    if (!localStorage.getItem('freecol.prefs'))
      localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.graphicsQuality': q } }));
  }, Number(quality));
}

// Frame and long-task recorder, installed before the page's own scripts, and the
// client Engine's last map view (as play.mjs keeps it) to tell when a turn is back.
await page.addInitScript(() => {
  const w = window;
  let inner;
  Object.defineProperty(w, 'fcClientEvent', {
    configurable: true,
    get: () => inner,
    set: (f) => {
      inner = (name, detail) => {
        if (name === 'map' || name === 'gameStarted') w.__map = JSON.parse(detail);
        return f(name, detail);
      };
    },
  });
  w.__perf = { frames: [], long: [], draws: [], blits: [], uploads: [] };
  // Each texture upload's time and size in pixels (a new sprite's, a text's).
  for (const C of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) {
    for (const f of ['texImage2D', 'texSubImage2D']) {
      const orig = C?.prototype[f];
      if (!orig) continue;
      C.prototype[f] = function (...a) {
        const src = a.find((x) => x && typeof x === 'object' && 'width' in x);
        const px = src
          ? src.width * src.height
          : typeof a[3] === 'number' && typeof a[4] === 'number'
            ? a[3] * a[4]
            : 0;
        w.__perf.uploads.push([performance.now(), px]);
        return orig.apply(this, a);
      };
    }
  }
  // Each Canvas 2D drawImage's time (the minimap, the Canvas 2D map).
  // Taken with Reflect.get, as the wrapper calls it with its own `this`.
  const ctx2d = w.CanvasRenderingContext2D.prototype;
  const blit = Reflect.get(ctx2d, 'drawImage');
  const skipMinimap = new URLSearchParams(location.search).has('perfnominimap');
  ctx2d.drawImage = function (...a) {
    if (skipMinimap && this.canvas.closest?.('#minimap')) return;
    w.__perf.blits.push(performance.now());
    return blit.apply(this, a);
  };
  // Each WebGL draw call's time, to tell the map's renders from the page's own repaints.
  for (const C of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) {
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = C?.prototype[f];
      if (orig)
        C.prototype[f] = function (...a) {
          w.__perf.draws.push(performance.now());
          return orig.apply(this, a);
        };
    }
  }
  let last = 0;
  const tick = (t) => {
    if (last) w.__perf.frames.push([t, t - last]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.long.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
});

const t0 = Date.now();
// --no-minimap skips the minimap's drawing, to see what it costs.
const noMinimap = process.argv.includes('--no-minimap');
await page.goto(`${server.url}?skipstart${noMinimap ? '&perfnominimap' : ''}${query ? `&${query}` : ''}`);
await waitForResult(page, 180000);
console.log(`chromium ${browser.version()}, game ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// --dim-off turns the unfocused window's grey-out off, to see what its backdrop filter costs.
if (process.argv.includes('--dim-off')) await page.evaluate(() => (document.body.dataset.dimUnfocused = 'off'));
console.log(
  `grey-out: ${await page.evaluate(() => `${document.body.dataset.dimUnfocused}, unfocused ${document.body.dataset.unfocused}`)}`,
);
const renderer = await page.evaluate(() => window.fcResult?.renderer);
console.log(`renderer: ${renderer}`);
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c?.getExtension('WEBGL_debug_renderer_info');
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no webgl2';
});
console.log(`GL: ${gl}`);

const box = await page.locator('#map canvas').boundingBox();
const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
const pause = (ms) => page.waitForTimeout(ms);

const phases = [];
const phase = async (name, run) => {
  const start = await page.evaluate((n) => (performance.mark(`perf-start:${n}`), performance.now()), name);
  const wall = Date.now();
  await run();
  const end = await page.evaluate((n) => (performance.mark(`perf-end:${n}`), performance.now()), name);
  phases.push({ name, start, end, wall: Date.now() - wall });
};

await browser.startTracing(page, {
  path: path.join(out, 'trace.json'),
  categories: [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'v8.execute',
    'disabled-by-default-v8.cpu_profiler',
    'blink.user_timing',
    'toplevel',
    'gpu',
  ],
});

await phase('idle', () => pause(3000));
await phase('pan (middle drag)', async () => {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) {
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + (i % 2 ? -300 : 300), cy + (i % 2 ? -150 : 150), { steps: 60 });
    await page.mouse.up({ button: 'middle' });
    await page.mouse.move(cx, cy);
  }
});
await phase('zoom (wheel)', async () => {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -100);
    await pause(150);
  }
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 100);
    await pause(150);
  }
});
await phase('edge scroll', async () => {
  await page.mouse.move(box.x + box.width - 3, cy);
  await pause(2000);
  await page.mouse.move(box.x + 3, cy);
  await pause(2000);
  await page.mouse.move(cx, cy);
});
await phase('hover', async () => {
  for (let i = 0; i < 80; i++) await page.mouse.move(cx + ((i * 37) % 600) - 300, cy + ((i * 53) % 400) - 200);
});
await phase('unit moves (keys)', async () => {
  for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(k);
    await pause(400);
  }
});
await phase(`end ${turns} turns`, async () => {
  for (let i = 0; i < turns; i++) {
    const turn = await page.evaluate(() => window.__map?.turn);
    await page.keyboard.press('Enter');
    await page
      .waitForFunction((t) => window.__map?.turn !== t && window.__map?.ourTurn, turn, { timeout: 120000 })
      .catch(() => console.log(`  turn ${i + 1} did not come back in 120 s`));
    await page.keyboard.press('Enter'); // a second Enter: units with moves left ask first
    await pause(300);
  }
});

await browser.stopTracing();
const rec = await page.evaluate(() => window.__perf);
const mem = await page.evaluate(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1048576));
await browser.close();
server.close();

// --- Frame times and long tasks per phase.
const ups = (p) => rec.uploads.filter(([t]) => t >= p.start && t <= p.end);
const draws = (p) => rec.draws.filter((t) => t >= p.start && t <= p.end);
const pct = (xs, p) =>
  xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0;
console.log(`\nmain-thread JS heap at the end: ${mem} MB`);
console.log(
  '\nphase                 wall_s  frames  fps   p50_ms  p95_ms  max_ms  >50ms  long_tasks  long_ms  gl_draws  frames_drawn  2d_images',
);
for (const p of phases) {
  const f = rec.frames.filter(([t]) => t >= p.start && t <= p.end).map(([, d]) => d);
  const l = rec.long.filter(([t]) => t >= p.start && t <= p.end);
  const secs = (p.end - p.start) / 1000;
  console.log(
    `${p.name.padEnd(20)} ${secs.toFixed(1).padStart(7)} ${String(f.length).padStart(7)} ${(f.length / secs).toFixed(0).padStart(5)}` +
      ` ${pct(f, 0.5).toFixed(1).padStart(7)} ${pct(f, 0.95).toFixed(1).padStart(7)} ${Math.max(0, ...f)
        .toFixed(0)
        .padStart(7)}` +
      ` ${String(f.filter((d) => d > 50).length).padStart(6)} ${String(l.length).padStart(11)} ${l
        .reduce((a, [, d]) => a + d, 0)
        .toFixed(0)
        .padStart(8)}` +
      ` ${String(draws(p).length).padStart(9)} ${String(new Set(draws(p).map((t) => Math.floor(t / 16.67))).size).padStart(13)}` +
      ` ${String(rec.blits.filter((t) => t >= p.start && t <= p.end).length).padStart(10)}` +
      ` ${String(ups(p).length).padStart(8)} ${(ups(p).reduce((a, [, px]) => a + px, 0) / 1e6).toFixed(1).padStart(11)}`,
  );
}

// --- The trace: thread names, busy time per thread per phase, and sampled self time per function.
const trace = JSON.parse(fs.readFileSync(path.join(out, 'trace.json'), 'utf8'));
const events = trace.traceEvents ?? trace;
const threads = new Map();
for (const e of events) if (e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
const tname = (k) => threads.get(k) ?? k;

// Map the page's performance.now() to trace time with the first frame's TracingStartedInBrowser? Simpler:
// time of each phase relative to the trace start, by wall-clock proportions is unreliable, so busy time is per run.
const busy = new Map();
for (const e of events) {
  if (e.ph !== 'X' || !e.dur) continue;
  if (e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask') continue;
  const k = `${e.pid}:${e.tid}`;
  busy.set(k, (busy.get(k) ?? 0) + e.dur / 1000);
}
const traceSpan = (() => {
  let lo = Infinity,
    hi = 0;
  for (const e of events)
    if (e.ts) {
      lo = Math.min(lo, e.ts);
      hi = Math.max(hi, e.ts);
    }
  return (hi - lo) / 1000;
})();
console.log(`\nbusy time per thread over the ${(traceSpan / 1000).toFixed(1)} s trace (top-level tasks):`);
for (const [k, ms] of [...busy].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(
    `  ${tname(k).padEnd(28)} ${ms.toFixed(0).padStart(7)} ms  ${((100 * ms) / traceSpan).toFixed(0).padStart(3)}%`,
  );
}

// Busy time per phase on the busiest threads, between the phases' marks in the trace.
const marks = new Map();
for (const e of events) {
  const m = /^perf-(start|end):(.*)$/.exec(e.name ?? '');
  if (m && e.ts) marks.set(`${m[1]}:${m[2]}`, e.ts);
}
const watched = [...busy]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 4)
  .map(([k]) => k);
console.log(`\nbusy % per phase:  ${watched.map((k) => tname(k).slice(0, 14).padStart(15)).join('')}`);
for (const p of phases) {
  const lo = marks.get(`start:${p.name}`);
  const hi = marks.get(`end:${p.name}`);
  if (!lo || !hi) continue;
  const cells = watched.map((k) => {
    // Tasks nest (a task run inside another's), so the busy time is the union of their spans.
    const spans = events
      .filter((e) => e.ph === 'X' && e.dur && `${e.pid}:${e.tid}` === k && e.name.endsWith('RunTask'))
      .map((e) => [Math.max(e.ts, lo), Math.min(e.ts + e.dur, hi)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let us = 0;
    let to = -Infinity;
    for (const [a, b] of spans) {
      if (b <= to) continue;
      us += b - Math.max(a, to);
      to = b;
    }
    return `${((100 * us) / (hi - lo)).toFixed(0)}%`.padStart(15);
  });
  console.log(`  ${p.name.padEnd(18)}${cells.join('')}`);
}

// CPU profile chunks: one profile per thread (keyed by the Profile event's id).
const profiles = new Map();
for (const e of events) {
  if (e.name !== 'Profile' && e.name !== 'ProfileChunk') continue;
  const id = `${e.pid}:${e.id}`;
  if (!profiles.has(id)) profiles.set(id, { thread: `${e.pid}:${e.tid}`, nodes: new Map(), samples: [], deltas: [] });
  const p = profiles.get(id);
  if (e.name === 'Profile') continue;
  const d = e.args?.data ?? {};
  for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
  p.samples.push(...(d.cpuProfile?.samples ?? []));
  p.deltas.push(...(d.timeDeltas ?? []));
}
for (const p of profiles.values()) {
  if (!p.samples.length) continue;
  const self = new Map();
  let total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const n = p.nodes.get(p.samples[i]);
    const dt = (p.deltas[i + 1] ?? 0) / 1000;
    total += dt;
    const cf = n?.callFrame ?? {};
    const name = `${cf.functionName || '(anonymous)'} ${cf.url ? path.basename(cf.url).split('?')[0] : ''}${cf.lineNumber >= 0 ? `:${cf.lineNumber + 1}` : ''}`;
    self.set(name, (self.get(name) ?? 0) + dt);
  }
  const idle = (self.get('(idle) ') ?? 0) + (self.get('(program) ') ?? 0);
  console.log(
    `\nself time, ${tname(p.thread)} (${(total / 1000).toFixed(1)} s sampled, ${((total - idle) / 1000).toFixed(1)} s not idle):`,
  );
  for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${((100 * ms) / total).toFixed(1).padStart(5)}%  ${name}`);
  }
}
console.log(`\ntrace: ${path.join(out, 'trace.json')}`);
