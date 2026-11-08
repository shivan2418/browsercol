// Measures panning the map with the middle mouse button: a scripted middle-button drag in a circle, sent through
// Chromium's own input pipeline (CDP Input.dispatchMouseEvent) at several mouse rates, from about one move a frame
// to a gaming mouse's 1000 Hz. For each rate it prints the pointer events the page got, the frame times
// (requestAnimationFrame intervals) and, from a CPU-profiled trace, the main thread's time per frame split by
// what it was spent on: the pan dispatch, React, PixiJS's culling and render, the map's tick loop, GC, style and
// layout. The raw trace is kept in .cache/perf/pan-trace.json.
// Run in the web image (a dist/ built with `vp build --minify false` keeps the function names the split needs):
//   DEV_VARIANT=web ./dev.sh node ui/scripts/pan.ts [--rates 60,250,1000] [--secs 4] [--query preset=pan-large]
// --gpu draws on a real GPU, which needs the container to see it (dev.sh's docker run with --device /dev/dri/renderD128
// added); without it headless Chromium draws WebGL with SwiftShader, on the CPU, and the GPU's work swamps the rest.
// --tag NAME names the run and its trace. CDP's input path tops out near 500 moves a second: at 1000 Hz the moves
// queue in the browser and reach the page in bursts, so read 1000 Hz as the harness's limit, not the page's.
import fs from 'node:fs';
import path from 'node:path';
import { opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const rates = opt('rates', '60,250,1000').split(',').map(Number);
const secs = Number(opt('secs', '4'));
const query = opt('query', 'preset=pan-large');
const tag = opt('tag', '');
const gpu = process.argv.includes('--gpu');
// #407's netbook settings: --size 1366x768, --throttle 4 (CDP Emulation.setCPUThrottlingRate, set once the game has
// started), --webgl1 (Chromium without WebGL 2), --zoom (a phase of zoom steps, and a pan zoomed out).
const [vw, vh] = opt('size', '1600x900').split('x').map(Number);
const throttle = Number(opt('throttle', '1'));
const webgl1 = process.argv.includes('--webgl1');
const zoomPhases = process.argv.includes('--zoom');
const out = path.resolve(import.meta.dirname, '../../.cache/perf');
fs.mkdirSync(out, { recursive: true });
const traceFile = path.join(out, `pan-trace${tag ? `-${tag}` : ''}.json`);

const server = await serveDist();
const browser = await playwright.chromium.launch({
  args: [
    ...(gpu
      ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization']
      : []),
    ...(webgl1 ? ['--disable-webgl2'] : []),
    // --nowebgl: no WebGL at all, which PixiJS meets with its own Canvas renderer.
    ...(process.argv.includes('--nowebgl') ? ['--disable-webgl'] : []),
  ],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await answerDialogs(page);
page.on('pageerror', (e) => console.log(`page error: ${e}`));

await page.addInitScript(() => {
  const w: any = window;
  w.__pan = { frames: [] as [number, number][], moves: [] as [number, number][], long: [] as [number, number][] };
  let last = 0;
  const tick = (t: number) => {
    if (last) w.__pan.frames.push([t, t - last]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Each pointermove the page got, with how many mouse moves Chromium coalesced into it.
  addEventListener(
    'pointermove',
    (e) => w.__pan.moves.push([performance.now(), e.getCoalescedEvents?.().length || 1]),
    { capture: true },
  );
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__pan.long.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // The GPU's time per frame (#409), where WebGL 2 has EXT_disjoint_timer_query_webgl2 (a real GPU, not SwiftShader):
  // a time query from the first draw of a task to its end, so a frame's draws, which PixiJS makes in one task.
  w.__pan.gpu = [] as [number, number][];
  // eslint-disable-next-line typescript/unbound-method -- called with its canvas below
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    const g = (getContext as any).call(this, kind, ...rest);
    if (kind !== 'webgl2' || !g || g.__timed) return g;
    g.__timed = true;
    const ext = g.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return g;
    const pending: [WebGLQuery, number][] = [];
    let open: WebGLQuery | null = null;
    const collect = () => {
      while (pending.length && g.getQueryParameter(pending[0][0], g.QUERY_RESULT_AVAILABLE)) {
        const [q, t] = pending.shift()!;
        if (!g.getParameter(ext.GPU_DISJOINT_EXT)) w.__pan.gpu.push([t, g.getQueryParameter(q, g.QUERY_RESULT) / 1e6]);
        g.deleteQuery(q);
      }
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const draw = g[name];
      g[name] = function (...args: unknown[]) {
        if (!open) {
          collect();
          open = g.createQuery();
          g.beginQuery(ext.TIME_ELAPSED_EXT, open);
          const t = performance.now();
          setTimeout(() => {
            g.endQuery(ext.TIME_ELAPSED_EXT);
            pending.push([open!, t]);
            open = null;
          }, 0);
        }
        return draw.apply(g, args);
      };
    }
    return g;
  } as typeof getContext;
});

// --quality N: FreeCol's graphics quality (10, low: no antialiasing); --still: no water and river animation.
const quality = opt('quality');
const still = process.argv.includes('--still');
if (quality || still)
  await page.addInitScript((o) => localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: o })), {
    ...(quality ? { 'model.option.graphicsQuality': Number(quality) } : {}),
    ...(still ? { 'model.option.useTerrainAnimations': false } : {}),
  });
await page.goto(`${server.url}?skipstart&${query}`);
const ready = await waitForResult(page, 240000);
if (ready.status === 'failed') {
  console.log(`the game did not start: ${ready.error}`);
  await browser.close();
  server.close();
  process.exit(1);
}
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c?.getExtension('WEBGL_debug_renderer_info');
  return d ? c!.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no webgl2';
});
console.log(
  `chromium ${browser.version()}${tag ? `, ${tag}` : ''}; renderer ${ready.renderer}; GL ${gl}; query ${query}`,
);
// Let the opening draws and dialogs settle.
await page.waitForTimeout(3000);

const box = (await page.locator('#map canvas').boundingBox())!;
const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
const cdp = await page.context().newCDPSession(page);
const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number, buttons: number) =>
  cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'middle',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });

/** A middle-button drag around a circle of 150 px, one turn per 2 s (about 470 px/s), with `hz` moves a second. */
async function drag(hz: number) {
  const r = 150;
  const at = (t: number): [number, number] => [cx + r * Math.cos(Math.PI * t), cy + r * Math.sin(Math.PI * t)];
  await mouse('mouseMoved', ...at(0), 0);
  await mouse('mousePressed', ...at(0), 4);
  const sent: Promise<unknown>[] = [];
  const t0 = performance.now();
  const end = t0 + secs * 1000;
  for (let i = 1; ; i++) {
    const due = t0 + (i * 1000) / hz;
    if (due > end) break;
    let now = performance.now();
    while (now < due - 1) {
      await new Promise((ok) => setTimeout(ok, Math.min(4, due - now - 1)));
      now = performance.now();
    }
    while (performance.now() < due); // the last millisecond spun, for an even rate
    sent.push(mouse('mouseMoved', ...at((due - t0) / 1000), 4));
  }
  await Promise.all(sent);
  await mouse('mouseReleased', ...at(secs), 0);
  return sent.length;
}

await browser.startTracing(page, {
  path: traceFile,
  categories: [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'v8.execute',
    'v8',
    'disabled-by-default-v8.cpu_profiler',
    'blink.user_timing',
    'toplevel',
    'gpu',
  ],
});
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const phases: { name: string; hz: number; start: number; end: number; sent: number }[] = [];
const wheel = async (steps: number) => {
  for (let i = 0; i < Math.abs(steps); i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: cx,
      y: cy,
      deltaX: 0,
      deltaY: steps > 0 ? -100 : 100,
    });
    await page.waitForTimeout(150);
  }
};
const mark = (n: string) => page.evaluate((n) => (performance.mark(n), performance.now()), n);
const phase = async (name: string, hz: number, run: () => Promise<number>) => {
  const start = await mark(`pan-start:${name}`);
  const sent = await run();
  phases.push({ name, hz, start, end: await mark(`pan-end:${name}`), sent });
};
await phase('idle', 0, async () => (await page.waitForTimeout(2000), 0));
for (const hz of rates) {
  await phase(`pan ${hz} Hz`, hz, () => drag(hz));
  await page.waitForTimeout(500);
}
if (zoomPhases) {
  // Zoom out twice, in four times and out twice, back to zoom 1, a step every 0.8 s.
  await phase('zoom steps', 0, async () => {
    for (const s of [-1, -1, 1, 1, 1, 1, -1, -1]) {
      await wheel(s);
      await page.waitForTimeout(800);
    }
    return 0;
  });
  await wheel(-2);
  await page.waitForTimeout(1500);
  await phase('pan 60 Hz @0.5', 60, () => drag(60));
  await wheel(2);
}
await browser.stopTracing();
const rec = (await page.evaluate(() => (window as any).__pan)) as {
  frames: [number, number][];
  moves: [number, number][];
  long: [number, number][];
  gpu: [number, number][];
};
await browser.close();
server.close();

const pct = (xs: number[], p: number) =>
  xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]! : 0;
const within = <T extends [number, ...unknown[]]>(xs: T[], p: { start: number; end: number }) =>
  xs.filter(([t]) => t >= p.start && t <= p.end);

const summary: Record<string, Record<string, number | null>> = {};
console.log('\nphase           sent/s  ptrmove/s  coalesced  fps   p50_ms  p95_ms  max_ms  >16.7ms  >33ms  long_tasks');
for (const p of phases) {
  const s = (p.end - p.start) / 1000;
  const f = within(rec.frames, p).map(([, d]) => d);
  const m = within(rec.moves, p);
  const coalesced = m.reduce((a, [, n]) => a + n, 0);
  console.log(
    `${p.name.padEnd(15)} ${(p.sent / s).toFixed(0).padStart(6)} ${(m.length / s).toFixed(0).padStart(10)}` +
      ` ${(m.length ? coalesced / m.length : 0).toFixed(2).padStart(10)} ${(f.length / s).toFixed(0).padStart(5)}` +
      ` ${pct(f, 0.5).toFixed(1).padStart(7)} ${pct(f, 0.95).toFixed(1).padStart(7)} ${Math.max(0, ...f)
        .toFixed(1)
        .padStart(7)}` +
      ` ${String(f.filter((d) => d > 17.5).length).padStart(8)} ${String(f.filter((d) => d > 34).length).padStart(6)}` +
      ` ${String(within(rec.long, p).length).padStart(11)}`,
  );
  summary[p.name] = {
    fps: f.length / s,
    p50: pct(f, 0.5),
    p95: pct(f, 0.95),
    max: Math.max(0, ...f),
    over16: f.filter((d) => d > 17.5).length,
    over33: f.filter((d) => d > 34).length,
    ...(() => {
      const g = within(rec.gpu, p).map(([, ms]) => ms);
      return g.length
        ? { gpuP50: pct(g, 0.5), gpuP95: pct(g, 0.95), gpuFrames: g.length }
        : ({} as Record<string, number>);
    })(),
    frames: f.length,
  };
}
// --- The trace: the renderer's main thread, its CPU profile, and its trace events, per phase.
const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
const events: any[] = trace.traceEvents ?? trace;
const names = new Map<string, string>();
for (const e of events) if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
const marks = new Map<string, number>();
for (const e of events) {
  const m = /^pan-(start|end):(.*)$/.exec(e.name ?? '');
  if (m && e.ts && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b' || e.ph === 'e'))
    marks.set(`${m[1]}:${m[2]}`, e.ts);
}
// The main thread is the one the marks are on.
const markEvent = events.find((e) => (e.name ?? '').startsWith('pan-start:'));
const main = `${markEvent.pid}:${markEvent.tid}`;

// The main thread's CPU profile, as samples with their time and stack (function names, leaf last).
type Sample = { ts: number; dt: number; stack: string[] };
const samples: Sample[] = [];
{
  const nodes = new Map<number, any>();
  let start = 0;
  let profileId = '';
  for (const e of events) {
    if (e.name === 'Profile' && `${e.pid}:${e.tid}` === main) {
      profileId = e.id;
      start = e.args.data.startTime;
    }
  }
  const ids: number[] = [];
  const deltas: number[] = [];
  for (const e of events) {
    if (e.name !== 'ProfileChunk' || e.id !== profileId || `${e.pid}` !== main.split(':')[0]) continue;
    const d = e.args?.data ?? {};
    for (const n of d.cpuProfile?.nodes ?? []) nodes.set(n.id, n);
    ids.push(...(d.cpuProfile?.samples ?? []));
    deltas.push(...(d.timeDeltas ?? []));
  }
  const parent = new Map<number, number>();
  for (const n of nodes.values()) {
    if (n.parent) parent.set(n.id, n.parent);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const stackOf = new Map<number, string[]>();
  const stack = (id: number): string[] => {
    let s = stackOf.get(id);
    if (s) return s;
    const n = nodes.get(id);
    const name = n?.callFrame?.functionName || '(anonymous)';
    const p = parent.get(id);
    s = [...(p !== undefined ? stack(p) : []), name];
    stackOf.set(id, s);
    return s;
  };
  let ts = start;
  for (let i = 0; i < ids.length; i++) {
    ts += deltas[i] ?? 0;
    // Each sample stands for the time until the next one.
    samples.push({ ts, dt: (deltas[i + 1] ?? 0) / 1000, stack: stack(ids[i]) });
  }
}
const interval = (() => {
  const d = samples.slice(1).map((s, i) => s.ts - samples[i].ts);
  return pct(d, 0.5) / 1000;
})();

/** What a sample's time was spent on: the first rule that matches its stack, root first. */
const has = (s: string[], ...fs: string[]) => fs.some((f) => s.includes(f));
const category = (s: string[]): string | null => {
  const leaf = s[s.length - 1];
  if (leaf === '(idle)') return null;
  if (leaf === '(garbage collector)') return 'GC';
  if (leaf === '(program)') return 'native (program)';
  if (has(s, 'cull', '_cullRecursive')) return 'PixiJS cull';
  if (has(s, 'refresh', 'setBleed')) return 'map chunks: build, bleed';
  if (has(s, 'tick', 'animateBase')) return 'map tick loop';
  if (has(s, 'showPanel', 'renderSide')) return 'pan dispatch: showPanel/renderSide (sync part)';
  if (has(s, 'renderMinimap')) return 'pan dispatch: renderMinimap (sync part)';
  if (has(s, 'dispatch')) return 'pan dispatch: reduce + map.show';
  if (has(s, 'showNow', 'overlayOf', 'modeOpsOf')) return 'map showNow (overlay check)';
  if (has(s, 'performWorkUntilDeadline', 'performWorkOnRoot', 'flushSyncWorkAcrossRoots_impl', 'commitRoot'))
    return 'React render/commit';
  if (has(s, 'render')) return 'PixiJS render (+ other render)';
  return `other: ${s.slice(-3).join(' < ')}`;
};

for (const p of phases) {
  const lo = marks.get(`start:${p.name}`);
  const hi = marks.get(`end:${p.name}`);
  if (!lo || !hi) continue;
  const frames = within(rec.frames, p).length || 1;
  const ms = (hi - lo) / 1000;
  const byCat = new Map<string, number>();
  const others = new Map<string, number>();
  for (const s of samples) {
    if (s.ts < lo || s.ts > hi) continue;
    const c = category(s.stack);
    if (!c) continue;
    if (c.startsWith('other: ')) others.set(c, (others.get(c) ?? 0) + s.dt);
    else byCat.set(c, (byCat.get(c) ?? 0) + s.dt);
  }
  const otherTotal = [...others.values()].reduce((a, b) => a + b, 0);
  // Trace events on the main thread: style, layout, paint, GC, and the event and frame callbacks.
  const ev = new Map<string, { n: number; ms: number }>();
  for (const e of events) {
    if (e.ph !== 'X' || `${e.pid}:${e.tid}` !== main || e.ts < lo || e.ts > hi) continue;
    const key = e.name === 'EventDispatch' ? `EventDispatch ${e.args?.data?.type}` : e.name;
    if (
      !/^(EventDispatch pointermove|FireAnimationFrame|UpdateLayoutTree|Layout|Paint|PrePaint|Layerize|Commit|MinorGC|MajorGC|V8.GC_SCAVENGER|RunMicrotasks|TimerFire|FunctionCall)$/.test(
        key,
      )
    )
      continue;
    const s = ev.get(key) ?? { n: 0, ms: 0 };
    ev.set(key, { n: s.n + 1, ms: s.ms + e.dur / 1000 });
  }
  const busy = [...byCat.values()].reduce((a, b) => a + b, 0) + otherTotal;
  // The main thread's busy time from its top-level tasks, their spans joined, as a check on the profile's.
  const spans = events
    .filter((e) => e.ph === 'X' && e.dur && `${e.pid}:${e.tid}` === main && e.name.endsWith('RunTask'))
    .map((e) => [Math.max(e.ts, lo), Math.min(e.ts + e.dur, hi)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let taskUs = 0;
  let to = -Infinity;
  for (const [a, b] of spans) {
    if (b <= to) continue;
    taskUs += b - Math.max(a, to);
    to = b;
  }
  console.log(
    `\n${p.name}: ${frames} frames in ${ms.toFixed(0)} ms; main thread busy ${busy.toFixed(0)} ms (${((100 * busy) / ms).toFixed(0)}%), ${(busy / frames).toFixed(2)} ms/frame by the CPU profile (${interval.toFixed(2)} ms samples); in tasks ${(taskUs / 1000).toFixed(0)} ms, ${(taskUs / 1000 / frames).toFixed(2)} ms/frame`,
  );
  Object.assign((summary[p.name] ??= {}), { mainMs: taskUs / 1000 / frames, busyMs: busy / frames });
  for (const [c, t] of [...byCat].sort((a, b) => b[1] - a[1]))
    console.log(`  ${c.padEnd(50)} ${t.toFixed(0).padStart(6)} ms ${(t / frames).toFixed(2).padStart(7)} ms/frame`);
  console.log(
    `  ${'other'.padEnd(50)} ${otherTotal.toFixed(0).padStart(6)} ms ${(otherTotal / frames).toFixed(2).padStart(7)} ms/frame`,
  );
  for (const [c, t] of [...others].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`    ${c.slice(7, 90).padEnd(86)} ${t.toFixed(0).padStart(5)} ms`);
  console.log('  trace events (count, ms, ms/frame):');
  for (const [k, s] of [...ev].sort((a, b) => b[1].ms - a[1].ms))
    console.log(
      `    ${k.padEnd(30)} ${String(s.n).padStart(6)} ${s.ms.toFixed(0).padStart(6)} ${(s.ms / frames).toFixed(2).padStart(7)}`,
    );
}
// The functions with the most self time over all the pan phases.
{
  const lo = Math.min(...phases.filter((p) => p.hz).map((p) => marks.get(`start:${p.name}`)!));
  const hi = Math.max(...phases.filter((p) => p.hz).map((p) => marks.get(`end:${p.name}`)!));
  const self = new Map<string, number>();
  for (const s of samples) {
    if (s.ts < lo || s.ts > hi) continue;
    const leaf = s.stack.at(-1)!;
    if (leaf === '(idle)') continue;
    self.set(leaf, (self.get(leaf) ?? 0) + s.dt);
  }
  console.log('\nself time over the pan phases:');
  for (const [f, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(opt('top', '20'))))
    console.log(`  ${f.slice(0, 60).padEnd(60)} ${t.toFixed(0).padStart(6)} ms`);
}
if (!rec.gpu.length) console.log('\nno GPU times: no EXT_disjoint_timer_query_webgl2 (SwiftShader, or WebGL 1)');
else
  for (const p of phases) {
    const g = within(rec.gpu, p).map(([, ms]) => ms);
    if (g.length)
      console.log(
        `GPU ${p.name}: ${g.length} frames, p50 ${pct(g, 0.5).toFixed(2)} ms, p95 ${pct(g, 0.95).toFixed(2)} ms`,
      );
  }
console.log(`\nSUMMARY ${JSON.stringify({ tag, query, size: `${vw}x${vh}`, throttle, gpu, webgl1, phases: summary })}`);
