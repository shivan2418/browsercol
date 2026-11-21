// How snappy a unit move feels, end to end, in the built site: the time from the key press (or click) to the
// unit's slide starting on screen, and to the unit at rest on its new tile, with where the time goes and what the
// move costs in messages and bytes (the waste: work done per move that nothing needs). It times
//   explored   a land step into explored land (a scout)
//   reveals    a land step that explores new tiles
//   sea        a ship's step at sea
//   goto       a Go To of about 5 sea tiles (the ship): its first step and the whole path
// each for --trials moves, and prints the median and p90 of: key to the slide's first frame, key to the slide's
// start, key to rest, the long tasks and the frames over 33 ms during the move; the stages (key to the order's
// post, the server's answer, the client's step, the slide's start and first frame); the messages the client and the
// server swapped (how many, how many were questions, their bytes), the maps the client sent the page (count and
// bytes), the time spent writing and reading the protocol's XML, the client Engine's map JSON, the page's handler of
// the map, and the map's scene and paint. It runs each browser at each --throttle (Chromium's CDP CPU throttling
// rate applied to the page while a move is timed; Firefox has none, so it runs at 1 only) and starts only while the
// machine's one-minute load is under --maxload (8), as timing on a busy machine is worthless. The table goes to the
// log and as JSON to .cache/move-latency/. Run in the web image, after `just build`:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/move-latency.ts [--browsers chromium,firefox] [--throttle 1,6] [--trials 10] [--preset move-latency] [--only explored,reveals,sea,goto] [--query renderer=pixi] [--verbose] [--label after]
// In the container Chromium draws WebGL in software (SwiftShader), so frames and long tasks there include the
// renderer's own cost, which a GPU does not have; Firefox draws with Canvas 2D (common.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright-core';
import type { ActiveUnit, MapView } from '../src/tileset.ts';
import { browserNames, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const trials = Number(opt('trials', '10'));
const throttles = opt('throttle', '1,6').split(',').map(Number);
const maxLoad = Number(opt('maxload', '8'));
const preset = opt('preset', 'move-latency');
const only = opt('only', 'explored,reveals,sea,goto').split(',');
const extra = opt('query', '') ? `&${opt('query', '')}` : '';
const label = opt('label', 'run');
const verbose = process.argv.includes('--verbose');

type Tile = [number, number];
type Rec = [string, number, ...unknown[]];
declare global {
  interface Window {
    /** The page's records: [kind, time, ...data]. */
    __rec: Rec[];
    __map: MapView;
    __maps: number;
  }
}

/** Records, kept by the page from before its own scripts run. */
function instrument() {
  window.__rec = [];
  window.__maps = 0;
  const rec = (kind: string, at: number, ...data: unknown[]) => window.__rec.push([kind, at, ...data]);
  const tag = (xml: string) => {
    const m = /^\s*<([\w-]+)/.exec(xml);
    if (!m) return '?';
    if (m[1] !== 'question' && m[1] !== 'reply') return m[1];
    const inner = /^\s*<[\w-]+[^>]*>\s*<([\w-]+)/.exec(xml);
    return `${m[1]}:${inner?.[1] ?? '-'}`;
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.name.startsWith('slide: ')) rec('slide', e.startTime, e.name.slice(7));
      else if (e.name.startsWith('cmd: ')) rec('cmd', e.startTime, e.name.slice(5));
    }
  }).observe({ type: 'mark' });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) rec('measure', e.startTime, e.name, e.duration);
  }).observe({ type: 'measure' });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) rec('long', e.startTime, e.duration);
    }).observe({ type: 'longtask' });
  } catch {}
  addEventListener('keydown', (e) => /^(Arrow|Numpad)/.test(e.code) && rec('key', e.timeStamp), true);
  addEventListener('click', (e) => rec('key', e.timeStamp), true);
  // The client Engine's messages to the server Engine in the Worker, and the Worker's answers.
  const Base = window.Worker;
  const post = Reflect.get(Base.prototype, 'postMessage') as Worker['postMessage'];
  Base.prototype.postMessage = function (this: Worker, ...a: Parameters<typeof post>) {
    const m = a[0] as { k?: string; xml?: string };
    if (m?.k === 'fc')
      rec('out', performance.now(), tag(m.xml!), m.xml!.length, performance.timeOrigin + performance.now());
    return Reflect.apply(post, this, a);
  } as typeof post;
  window.Worker = class extends Base {
    constructor(...a: ConstructorParameters<typeof Worker>) {
      super(...a);
      this.addEventListener('message', (e) => {
        const m = e.data as { k?: string; xml?: string; t?: number };
        if (m?.k === 'fc')
          rec('in', performance.now(), tag(m.xml!), m.xml!.length, m.t, performance.timeOrigin + performance.now());
      });
    }
  };
  const tick = (t: number) => {
    rec('frame', t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let show: ((kind: string, json: string) => unknown) | undefined;
  Object.defineProperty(window, 'fcShow', {
    configurable: true,
    get: () => show,
    set: (f: (kind: string, json: string) => unknown) => {
      show = (kind, json) => {
        rec('show', performance.now(), kind, json.length);
        return f(kind, json);
      };
    },
  });
  let inner: ((name: string, detail: string) => unknown) | undefined;
  Object.defineProperty(window, 'fcClientEvent', {
    configurable: true,
    get: () => inner,
    set: (f: (name: string, detail: string) => unknown) => {
      inner = (name, detail) => {
        const t0 = performance.now();
        if (name === 'map' || name === 'gameStarted') {
          window.__map = JSON.parse(detail);
          window.__maps++;
        }
        const t1 = performance.now();
        const r = f(name, detail);
        rec('event', t0, name, detail.length, t1 - t0, performance.now() - t1);
        return r;
      };
    },
  });
}

const DIRS = {
  E: [[1, 0], [1, 0], 'Numpad6'],
  W: [[-1, 0], [-1, 0], 'Numpad4'],
  N: [[0, -2], [0, -2], 'Numpad8'],
  S: [[0, 2], [0, 2], 'Numpad2'],
  NE: [[1, -1], [0, -1], 'Numpad9'],
  SE: [[1, 1], [0, 1], 'Numpad3'],
  SW: [[0, 1], [-1, 1], 'Numpad1'],
  NW: [[0, -1], [-1, -1], 'Numpad7'],
} as const;
type Dir = keyof typeof DIRS;
const dirs = Object.keys(DIRS) as Dir[];
const neighbour = ([x, y]: Tile, d: Dir): Tile => {
  const [dx, dy] = DIRS[d][y % 2 ? 0 : 1];
  return [x + dx, y + dy];
};
const typeOf = (m: MapView, [x, y]: Tile) => {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const i = m.tiles.charCodeAt(y * m.w + x) - 65;
  return i >= 0 ? m.types[i] : null;
};
const unknown = (m: MapView, [x, y]: Tile) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.tiles[y * m.w + x] === '.';
const empty = (m: MapView, t: Tile) =>
  !m.units.some((u) => u.x === t[0] && u.y === t[1]) && !m.settlements.some((s) => s.x === t[0] && s.y === t[1]);
/** How many tiles within two steps of `t` are unexplored. */
function hidden(m: MapView, t: Tile): number {
  const seen = new Set<string>([t.join()]);
  let ring: Tile[] = [t];
  let n = 0;
  for (let r = 0; r < 2; r++) {
    const next: Tile[] = [];
    for (const a of ring)
      for (const d of dirs) {
        const b = neighbour(a, d);
        if (seen.has(b.join())) continue;
        seen.add(b.join());
        next.push(b);
        if (unknown(m, b)) n++;
      }
    ring = next;
  }
  return n;
}
const explored = (m: MapView) => m.tiles.length - m.tiles.split('.').length - 1;

const sorted = (xs: number[]) => xs.filter(Number.isFinite).sort((a, b) => a - b);
const median = (xs: number[]) => {
  const s = sorted(xs);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const p90 = (xs: number[]) => {
  const s = sorted(xs);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)] : NaN;
};
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '-');

/** What one move cost. */
interface Trial {
  /** Key to the slide's first frame, to its start, and to the unit at rest (the last step's, for a Go To). */
  frame: number;
  start: number;
  rest: number;
  /** Stages, from the key: the order's post, the server's reply, the client's step, the slide's start, its first frame. */
  stages: Record<string, number>;
  /** Long tasks and frames over 33 ms between the key and rest. */
  longTasks: number;
  longMs: number;
  slowFrames: number;
  maxFrame: number;
  /** Messages in the move's window: sent, received, the questions among those received, and their bytes. */
  out: number;
  inn: number;
  questions: number;
  outBytes: number;
  inBytes: number;
  kinds: Record<string, number>;
  /** Maps the client sent the page, their bytes, the page's handler and the Engine's JSON, in ms. */
  maps: number;
  mapBytes: number;
  mapHandler: number;
  mapJson: number;
  /** The client's reads and writes of the protocol XML, and its handling of what it read, in ms and count. */
  xmlMs: number;
  handleMs: number;
  /** The map's scene and paint, in ms. */
  scene: number;
  paint: number;
  /** The key to the client Engine's command, to its running, and to the order's post (ms), and the Go To's path search. */
  toEngine: number;
  queue: number;
  gate: number;
  prelude: number;
  findPath: number;
  /** The server's part, from the order's post to the Worker's first answer, and the answer's trip back, in ms. */
  serverMs: number;
  backMs: number;
  /** New tiles explored by the move. */
  revealed: number;
  /** The goto's steps slid. */
  steps: number;
}

const CDP = new WeakMap<Page, CDPSession>();
async function throttle(page: Page, rate: number) {
  const s = CDP.get(page);
  if (s) await s.send('Emulation.setCPUThrottlingRate', { rate });
}

/** Do the order and time it, or null if no slide came. */
async function timed(page: Page, rate: number, order: () => Promise<unknown>, whole = false): Promise<Trial | null> {
  const before = await page.evaluate(() => ((window.__rec = []), window.__map));
  await throttle(page, rate);
  await order();
  // Rest: the slide's end; a Go To is done when no slide has come for a while.
  const got = await page
    .waitForFunction(() => window.__rec.some((r) => r[0] === 'slide' && r[2] === 'rest'), null, { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (whole) await page.waitForTimeout(1500);
  await page.waitForTimeout(300);
  await throttle(page, 1);
  const [rec, after] = await page.evaluate(() => [window.__rec, window.__map] as const);
  if (!got) return null;
  const key = rec.find((r) => r[0] === 'key')?.[1];
  if (key === undefined) return null;
  const at = (k: string, name?: string) =>
    rec.find((r) => r[0] === k && r[1] >= key - 0.01 && (!name || r[2] === name));
  const slide = (n: string) => at('slide', n)?.[1];
  const frame = slide('frame');
  const start = slide('start');
  const rests = rec.filter((r) => r[0] === 'slide' && r[2] === 'rest');
  const restAt = whole ? rests[rests.length - 1][1] : rests[0][1];
  if (frame === undefined || start === undefined) return null;
  const win = rec.filter((r) => r[1] >= key - 0.01 && r[1] <= restAt + 300);
  if (process.argv.includes('--timeline'))
    for (const r of win.filter((r) => r[0] !== 'frame'))
      console.log(
        `      ${(r[1] - key).toFixed(1).padStart(8)} ${r.slice(0, 1).concat(r.slice(2).map(String)).join(' ')}`,
      );
  const outs = win.filter((r) => r[0] === 'out');
  const ins = win.filter((r) => r[0] === 'in');
  const kinds: Record<string, number> = {};
  for (const r of ins) kinds[`in ${String(r[2])}`] = (kinds[`in ${String(r[2])}`] ?? 0) + 1;
  for (const r of outs) kinds[`out ${String(r[2])}`] = (kinds[`out ${String(r[2])}`] ?? 0) + 1;
  const sum = (rs: Rec[], i: number) => rs.reduce((a, r) => a + (r[i] as number), 0);
  const measures = (re: RegExp) => win.filter((r) => r[0] === 'measure' && re.test(r[2] as string));
  const events = win.filter((r) => r[0] === 'event' && r[2] === 'map');
  const frames = win.filter((r) => r[0] === 'frame' && r[1] <= restAt);
  const gaps = frames.slice(1).map((r, i) => r[1] - frames[i][1]);
  const longs = win.filter((r) => r[0] === 'long' && r[1] <= restAt);
  const cmdAt = (n: string) => rec.find((r) => r[0] === 'cmd' && r[1] >= key - 0.01 && String(r[2]).startsWith(n))?.[1];
  const step = at('show', 'animateMove')?.[1];
  const first = (xs: Rec[]) => xs[0]?.[1];
  const firstOut = first(outs);
  const firstIn = first(ins);
  const wt = ins[0]?.[4] as number | undefined;
  const sentEpoch = outs[0]?.[4] as number | undefined;
  const arrEpoch = ins[0]?.[5] as number | undefined;
  return {
    frame: frame - key,
    start: start - key,
    rest: restAt - key,
    stages: {
      post: firstOut === undefined ? NaN : firstOut - key,
      reply: firstOut === undefined || firstIn === undefined ? NaN : firstIn - firstOut,
      step: step === undefined || firstIn === undefined ? NaN : step - firstIn,
      start: step === undefined ? NaN : start - step,
      frame: frame - start,
    },
    longTasks: longs.length,
    longMs: sum(longs, 2),
    slowFrames: gaps.filter((g) => g > 33.4).length,
    maxFrame: Math.max(0, ...gaps),
    out: outs.length,
    inn: ins.length,
    questions: ins.filter((r) => String(r[2]).startsWith('question')).length,
    outBytes: sum(outs, 3),
    inBytes: sum(ins, 3),
    kinds,
    maps: events.length,
    mapBytes: sum(events, 3),
    mapHandler: sum(events, 4) + sum(events, 5),
    mapJson: sum(measures(/^map: json$/), 3),
    xmlMs: sum(measures(/^fc: (read|write) /), 3),
    handleMs: sum(measures(/^fc: handle /), 3),
    scene: sum(measures(/^map: scene/), 3),
    paint: sum(measures(/^map: paint/), 3),
    toEngine: cmdAt('enter') === undefined ? NaN : cmdAt('enter')! - key,
    queue: cmdAt('enter') === undefined || cmdAt('thread') === undefined ? NaN : cmdAt('thread')! - cmdAt('enter')!,
    gate: cmdAt('thread') === undefined || cmdAt('run') === undefined ? NaN : cmdAt('run')! - cmdAt('thread')!,
    prelude: cmdAt('run') === undefined || firstOut === undefined ? NaN : firstOut - cmdAt('run')!,
    findPath: sum(measures(/^cmd: findPath$/), 3),
    serverMs: wt === undefined || sentEpoch === undefined ? NaN : wt - sentEpoch,
    backMs: wt === undefined || arrEpoch === undefined ? NaN : arrEpoch - wt,
    revealed: explored(after) - explored(before),
    steps: rec.filter((r) => r[0] === 'slide' && r[2] === 'start').length,
  };
}

const view = (page: Page) => page.evaluate(() => window.__map);
async function endTurn(page: Page) {
  const turn = (await view(page)).turn;
  // The button, as a click on the map or a focused button can take the key; asked again if nothing happens.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.getByRole('button', { name: 'End turn (Enter)' }).click();
    const changed = await page
      .waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (changed) break;
    if (attempt === 5) throw new Error(`the turn ${turn} did not end`);
  }
  await page.waitForTimeout(500);
}
const SHIP = /Caravel|Galleon|Merchantman|Privateer|Frigate|Flute|Man.o|Ship|Brig/i;
const isShip = (u: ActiveUnit | null) => !!u && SHIP.test(u.label);
const movesLeft = (u: ActiveUnit | null) => !!u && !/^0(\s|$)/.test(u.moves);

/** Make a unit of the kind active: cycle with W (wait), or end the turn when none has moves. */
async function select(page: Page, ship: boolean): Promise<MapView> {
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 14; i++) {
      const m = await view(page);
      if (m.active && isShip(m.activeUnit) === ship && movesLeft(m.activeUnit)) return m;
      const n = await page.evaluate(() => window.__maps);
      await page.keyboard.press('w');
      await page.waitForFunction((n) => window.__maps > n, n, { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
    await endTurn(page);
  }
  throw new Error(`no ${ship ? 'ship' : 'land unit'} with moves`);
}

type Case = 'explored' | 'reveals' | 'sea' | 'goto';
/** A direction for the active unit's step in the case, or null when there is none for it. */
function choose(m: MapView, c: Case): Dir | null {
  const from = m.active!;
  let best: [number, Dir] | null = null;
  for (const d of dirs) {
    const t = neighbour(from, d);
    const type = typeOf(m, t);
    if (!type || !empty(m, t)) continue;
    if (type.land === (c === 'sea')) continue;
    const h = hidden(m, t);
    if (c === 'reveals' && h === 0) continue;
    // The most hidden for a reveal; for the rest, the least.
    if (c === 'reveals' ? !best || h > best[0] : !best || h < best[0]) best = [h, d];
  }
  return best?.[1] ?? null;
}

interface Result {
  case: Case;
  trials: Trial[];
  tried: number;
}

async function runCases(page: Page, url: string, rate: number): Promise<Result[]> {
  await page.goto(`${url}?skipstart&slidetiming&preset=${preset}${extra}`);
  await waitForResult(page, 180000);
  await page.waitForTimeout(2500);
  const out: Result[] = [];
  for (const c of ['reveals', 'explored', 'sea', 'goto'] as Case[]) {
    if (!only.includes(c)) continue;
    const got: Trial[] = [];
    let tried = 0;
    for (let guard = 0; got.length < trials && guard < trials * 8; guard++) {
      const ship = c === 'sea' || c === 'goto';
      const m = await select(page, ship);
      if (c === 'goto') {
        // A sea tile up to five steps off in one direction, the farthest explored.
        let target: Tile | null = null;
        let steps = 0;
        for (const d of dirs) {
          let t = m.active!;
          let n = 0;
          while (n < 5) {
            const next = neighbour(t, d);
            if (typeOf(m, next)?.land !== false || !empty(m, next)) break;
            t = next;
            n++;
          }
          if (n > steps) [target, steps] = [t, n];
        }
        if (!target || steps < 3) {
          await endTurn(page);
          continue;
        }
        const box = (await page.locator('#map canvas').boundingBox())!;
        const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), target);
        await page.mouse.move(box.x + px, box.y + py);
        await page.keyboard.press('g');
        await page.waitForTimeout(300);
        tried++;
        const t = await timed(page, rate, () => page.mouse.click(box.x + px, box.y + py), true);
        if (t) got.push(t);
        if (verbose)
          console.log(
            `      goto ${steps} steps: ${t ? `frame ${f1(t.frame)} rest ${f1(t.rest)} steps ${t.steps}` : 'no slide'}`,
          );
        await endTurn(page);
        continue;
      }
      const d = choose(m, c);
      if (!d) {
        // Nothing of this case here: the next unit, or the next turn.
        await page.keyboard.press('w');
        await page.waitForTimeout(300);
        if (guard % 6 === 5) await endTurn(page);
        continue;
      }
      tried++;
      const t = await timed(page, rate, () => page.keyboard.press(DIRS[d][2]));
      if (!t) continue;
      // A step that explored something is a reveal, and one that did not is not.
      if ((c === 'reveals') !== t.revealed > 0 && c !== 'sea') continue;
      got.push(t);
      if (verbose)
        console.log(`      ${c}: frame ${f1(t.frame)} start ${f1(t.start)} rest ${f1(t.rest)} revealed ${t.revealed}`);
    }
    out.push({ case: c, trials: got, tried });
  }
  return out;
}

const cell = (xs: number[]) => `${f1(median(xs))}/${f1(p90(xs))}`;
function print(name: string, rate: number, load: number, results: Result[]) {
  console.log(
    `\n${name}, CPU throttle ${rate}x${name === 'firefox' ? ' (Firefox has none)' : ''}, load ${load.toFixed(1)} (median/p90, ms)`,
  );
  for (const r of results) {
    const t = r.trials;
    if (!t.length) {
      console.log(`  ${r.case}: no trials (${r.tried} tried)`);
      continue;
    }
    const n = (k: (x: Trial) => number) => cell(t.map(k));
    console.log(
      `  ${r.case}: n=${t.length}  key->slide frame ${n((x) => x.frame)}  key->slide start ${n((x) => x.start)}  key->rest ${n((x) => x.rest)}`,
    );
    console.log(
      `    stages: post ${n((x) => x.stages.post)} (to Engine ${n((x) => x.toEngine)}, thread start ${n((x) => x.queue)}, gate ${n((x) => x.gate)}, prelude ${n((x) => x.prelude)}, find path ${n((x) => x.findPath)}), server+back ${n((x) => x.stages.reply)} (server ${n((x) => x.serverMs)}, back ${n((x) => x.backMs)}), client step ${n((x) => x.stages.step)}, slide start ${n((x) => x.stages.start)}, first frame ${n((x) => x.stages.frame)}`,
    );
    console.log(
      `    long tasks ${n((x) => x.longTasks)} (${n((x) => x.longMs)} ms), frames >33 ms ${n((x) => x.slowFrames)}, worst frame ${n((x) => x.maxFrame)}`,
    );
    console.log(
      `    msgs out ${n((x) => x.out)} (${n((x) => x.outBytes)} B), in ${n((x) => x.inn)} (${n((x) => x.questions)} questions, ${n((x) => x.inBytes)} B); maps ${n((x) => x.maps)} x ${f1(median(t.map((x) => x.mapBytes / Math.max(1, x.maps))))} B; map json ${n((x) => x.mapJson)}, page handler ${n((x) => x.mapHandler)}, scene ${n((x) => x.scene)}, paint ${n((x) => x.paint)}; xml ${n((x) => x.xmlMs)}, handle ${n((x) => x.handleMs)}; revealed ${n((x) => x.revealed)}`,
    );
    const mid = [...t].sort((a, b) => a.frame - b.frame)[Math.floor(t.length / 2)];
    console.log(
      `    messages of a median move: ${Object.entries(mid.kinds)
        .map(([k, v]) => `${k} x${v}`)
        .join(', ')}`,
    );
  }
}

async function loadOk() {
  for (;;) {
    const l = os.loadavg()[0];
    if (l < maxLoad) return l;
    console.log(`  load ${l.toFixed(1)} is not under ${maxLoad}: waiting 60 s`);
    await new Promise((ok) => setTimeout(ok, 60000));
  }
}

const site = await serveDist();
const dir = path.resolve(import.meta.dirname, '../../.cache/move-latency');
fs.mkdirSync(dir, { recursive: true });
let failed = false;
const all: unknown[] = [];
for (const name of browserNames()) {
  for (const rate of name === 'chromium' ? throttles : [1]) {
    const load = await loadOk();
    const browser = await launchBrowser(name);
    console.log(`${name} ${browser.version()}, throttle ${rate}, load ${load.toFixed(1)}`);
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      if (name === 'chromium') CDP.set(page, await page.context().newCDPSession(page));
      await page.addInitScript(instrument);
      await answerDialogs(page);
      const results = await runCases(page, site.url, rate);
      print(name, rate, load, results);
      all.push({ browser: name, rate, load, preset, results });
    } catch (ex) {
      failed = true;
      console.log(`  ${name} failed: ${String(ex)}`);
    } finally {
      await browser.close();
    }
  }
}
fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(all));
site.close();
process.exit(failed ? 1 : 0);
