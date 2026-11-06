// Times a move order to the first frame of the unit's slide (#312), in the
// built site: for a single step (the ship at sea), a Go To path (G, then a
// click on a sea tile a few tiles off) and a move into a colony (the ship of
// the colony-school preset, out of its coastal colony and back in). For each it
// prints, in milliseconds, the medians of where the time goes:
//   send    key or click to the client Engine's order going to the Worker
//   server  the order in the Worker to its first answer back
//   client  that answer to the step the client Engine tells of (animateMove)
//   wait    the step to the slide starting
//   frame   the slide's start to its first animation frame
// and, beside them, the step to the map that carries it being asked to be
// drawn (map) and that to its paint being done (paint). Then the whole
// key-to-frame time, the longest gap between frames in the first 600 ms the
// unit slides, and the page's frame interval. The page marks its part only
// with ?slidetiming (src/timing.ts). --verbose prints each trial, --timeline
// every mark and frame. In the container Chromium draws WebGL in software
// (SwiftShader), whose 50 ms renders show as long tasks and frame gaps that a
// GPU does not have. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/slide-timing.ts [--browsers chromium,firefox] [--trials 6] [--query renderer=pixi] [--only single|goto|colony] [--verbose] [--timeline]
import type { Page } from 'playwright-core';
import type { MapView } from '../src/tileset.ts';
import { browserNames, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const trials = Number(opt('trials', '6'));
/** More page parameters, e.g. renderer=pixi to draw Firefox with WebGL rather than common.ts's Canvas 2D. */
const extra = opt('query', '') ? `&${opt('query', '')}` : '';
/** The stages timed: from the first of one mark after the key to the first of the next after it. */
const STAGES: [string, string, string][] = [
  ['send', 'key', 'send'],
  ['server', 'send', 'reply'],
  ['client', 'reply', 'step'],
  ['wait', 'step', 'start'],
  ['frame', 'start', 'frame'],
  ['map', 'step', 'map'],
  ['paint', 'map', 'painted'],
];

type Tile = [number, number];
/** A tile's top-left corner in map pixels, as src/view.ts places it on its staggered rows. */
const tileOrigin = (x: number, y: number): Tile => [x * 128 + (y % 2) * 64, y * 32];
declare global {
  interface Window {
    __marks: [string, number][];
    __frames: number[];
    __map: MapView;
    __maps: number;
  }
}

/** Marks and frames, kept by the page from before its own scripts run. */
function instrument() {
  window.__marks = [];
  window.__frames = [];
  window.__maps = 0;
  const mark = (name: string, at = performance.now()) => window.__marks.push([name, at]);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name.startsWith('slide: ')) mark(e.name.slice(7), e.startTime);
  }).observe({ type: 'mark' });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries())
      if (e.name.startsWith('map: ')) mark(`${e.name} ${e.duration.toFixed(1)}`, e.startTime);
  }).observe({ type: 'measure' });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) mark(`longtask ${e.duration.toFixed(1)}`, e.startTime);
    }).observe({ type: 'longtask' });
  } catch {}
  // The order: a map key, or the click that sets a Go To off.
  addEventListener('keydown', (e) => /^(Arrow|Numpad)/.test(e.code) && mark('key', e.timeStamp), true);
  addEventListener('click', (e) => mark('key', e.timeStamp), true);
  // The client Engine's messages to the server Engine in the Worker, and the Worker's answers.
  const Base = window.Worker;
  const post = Reflect.get(Base.prototype, 'postMessage') as Worker['postMessage'];
  Base.prototype.postMessage = function (this: Worker, ...a: Parameters<typeof post>) {
    if ((a[0] as { k?: string })?.k === 'fc') mark('send');
    return Reflect.apply(post, this, a);
  } as typeof post;
  window.Worker = class extends Base {
    constructor(...a: ConstructorParameters<typeof Worker>) {
      super(...a);
      this.addEventListener('message', (e) => (e.data as { k?: string })?.k === 'fc' && mark('reply'));
    }
  };
  const tick = (t: number) => {
    window.__frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // The WebGUI's events (src/webgui.ts), for the timeline.
  let show: ((kind: string, json: string) => unknown) | undefined;
  Object.defineProperty(window, 'fcShow', {
    configurable: true,
    get: () => show,
    set: (f: (kind: string, json: string) => unknown) => {
      show = (kind, json) => {
        mark(`show ${kind}`);
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
        mark(`event ${name}`);
        if (name === 'map' || name === 'gameStarted') {
          window.__map = JSON.parse(detail);
          window.__maps++;
        }
        return f(name, detail);
      };
    },
  });
}

const DIRECTIONS = {
  E: [
    [1, 0],
    [1, 0],
  ],
  W: [
    [-1, 0],
    [-1, 0],
  ],
  N: [
    [0, -2],
    [0, -2],
  ],
  S: [
    [0, 2],
    [0, 2],
  ],
  NE: [
    [1, -1],
    [0, -1],
  ],
  SE: [
    [1, 1],
    [0, 1],
  ],
  SW: [
    [0, 1],
    [-1, 1],
  ],
  NW: [
    [0, -1],
    [-1, -1],
  ],
} as const;
type Dir = keyof typeof DIRECTIONS;
const KEYS: Record<Dir, string> = {
  N: 'Numpad8',
  NE: 'Numpad9',
  E: 'Numpad6',
  SE: 'Numpad3',
  S: 'Numpad2',
  SW: 'Numpad1',
  W: 'Numpad4',
  NW: 'Numpad7',
};
const neighbour = ([x, y]: Tile, d: Dir): Tile => {
  const [dx, dy] = DIRECTIONS[d][y % 2 ? 0 : 1];
  return [x + dx, y + dy];
};
const typeOf = (m: MapView, [x, y]: Tile) => {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const i = m.tiles.charCodeAt(y * m.w + x) - 65;
  return i >= 0 ? m.types[i] : null;
};
const empty = (m: MapView, t: Tile) =>
  !m.units.some((u) => u.x === t[0] && u.y === t[1]) && !m.settlements.some((s) => s.x === t[0] && s.y === t[1]);
const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

interface Trial {
  stages: Record<string, number>;
  total: number;
  /** The longest gap between frames while the unit slid. */
  gap: number;
}

/** Do the order and time it: null if no slide came. */
async function timed(page: Page, order: () => Promise<unknown>, settle = 1500): Promise<Trial | null> {
  await page.evaluate(() => ((window.__marks = []), (window.__frames = [])));
  await order();
  const got = await page
    .waitForFunction(() => window.__marks.some(([n]) => n === 'frame'), null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(settle);
  const [marks, frames] = await page.evaluate(() => [window.__marks, window.__frames] as const);
  if (!got) return null;
  const key = marks.find(([n]) => n === 'key')![1];
  /** When the first `name` after the key came, or after `from` when given. */
  const first = (name: string, from = name === 'key' ? key - 0.01 : key) =>
    marks.find(([n, t]) => n === name && t >= from)?.[1];
  const stages: Record<string, number> = {};
  for (const [name, from, to] of STAGES) {
    const f = first(from);
    const t = f === undefined ? undefined : first(to, f);
    stages[name] = f === undefined || t === undefined ? NaN : t - f;
  }
  const at = first('frame')!;
  const start = first('start')!;
  const during = frames.filter((t) => t >= start && t <= start + 600);
  const gap = Math.max(0, ...during.slice(1).map((t, i) => t - during[i]));
  if (process.argv.includes('--timeline')) {
    const lines = [
      ...marks.map(([n, t]) => [t, n] as const),
      ...frames.slice(1).map((t, i) => [t, `frame +${(t - frames[i]).toFixed(1)}`] as const),
    ]
      .filter(([t]) => t >= key - 1 && t <= key + 1200)
      .sort((a, b) => a[0] - b[0]);
    for (const [t, n] of lines) console.log(`      ${(t - key).toFixed(1).padStart(7)} ${n}`);
  }
  if (process.argv.includes('--verbose'))
    console.log(
      `    trial: total ${(at - key).toFixed(1)}; ${STAGES.map(([s]) => `${s} ${stages[s].toFixed(1)}`).join(', ')}; gap ${gap.toFixed(1)}`,
    );
  return { stages, total: at - key, gap };
}

function report(what: string, results: (Trial | null)[], frameMs: number) {
  const ok = results.filter((r): r is Trial => r !== null);
  const parts = STAGES.map(([s]) => `${s} ${median(ok.map((r) => r.stages[s])).toFixed(1)}`).join(', ');
  console.log(
    `  ${what}: ${ok.length}/${results.length} slid; key to first frame median ${median(ok.map((r) => r.total)).toFixed(1)} ms ` +
      `(min ${Math.min(...ok.map((r) => r.total)).toFixed(1)}, max ${Math.max(...ok.map((r) => r.total)).toFixed(1)}), ` +
      `${(median(ok.map((r) => r.total)) / frameMs).toFixed(1)} frames`,
  );
  console.log(`    ${parts}; longest frame gap in the slide ${median(ok.map((r) => r.gap)).toFixed(1)} ms`);
}

const view = (page: Page) => page.evaluate(() => window.__map);
async function endTurn(page: Page) {
  const turn = (await view(page)).turn;
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn && !!window.__map.active, turn, {
    timeout: 120000,
  });
}
/** A direction from the active unit to a free tile that `fits`, or null. */
function freeDir(m: MapView, fits: (land: boolean) => boolean): Dir | null {
  for (const d of Object.keys(DIRECTIONS) as Dir[]) {
    const t = neighbour(m.active!, d);
    const type = typeOf(m, t);
    if (type && fits(type.land) && empty(m, t)) return d;
  }
  return null;
}
/** Whether the active unit is where it was: it could not move. */
const same = (a: MapView, b: MapView) =>
  b.active?.join() === a.active?.join() && b.activeUnit?.moves === a.activeUnit?.moves;
const pressed = (page: Page, key: string) => () => page.keyboard.press(key);

async function run(page: Page, url: string) {
  await page.addInitScript(instrument);
  await answerDialogs(page);
  await page.goto(`${url}?skipstart&slidetiming&preset=play${extra}`);
  await waitForResult(page, 180000);
  await page.waitForTimeout(1500);
  const frameMs = await page.evaluate(async () => {
    const f = window.__frames.slice(-60);
    return (f[f.length - 1] - f[0]) / (f.length - 1);
  });
  console.log(`  frame interval ${frameMs.toFixed(1)} ms`);

  const only = opt('only', '');
  // Single steps: the ship to a free sea tile and back, ending the turn when it is out of moves.
  const single: (Trial | null)[] = [];
  while (single.length < trials && (!only || only === 'single')) {
    const m = await view(page);
    const d = m.active && freeDir(m, (land) => !land);
    if (!d) {
      await endTurn(page);
      continue;
    }
    single.push(await timed(page, pressed(page, KEYS[d])));
  }
  report('single step', single, frameMs);

  // Go To: a sea tile three steps off in one direction, chosen with G and a click.
  const gotos: (Trial | null)[] = [];
  for (
    let tries = 0;
    gotos.length < Math.max(3, trials / 2) && tries < trials * 3 && (!only || only === 'goto');
    tries++
  ) {
    await endTurn(page);
    const m = await view(page);
    let target: Tile | null = null;
    for (const d of Object.keys(DIRECTIONS) as Dir[]) {
      let t = m.active!;
      let ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        t = neighbour(t, d);
        ok = typeOf(m, t)?.land === false && empty(m, t);
      }
      if (ok) {
        target = t;
        break;
      }
    }
    if (!target) continue;
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), target);
    await page.mouse.move(box.x + px, box.y + py);
    await page.keyboard.press('g');
    await page.waitForTimeout(300);
    gotos.push(await timed(page, () => page.mouse.click(box.x + px, box.y + py), 2500));
  }
  report('go to', gotos, frameMs);

  if (only && only !== 'colony') return;
  // Into a colony: the colony-school preset's ship sails to its coastal colony, and then out of it and back in.
  await page.goto(`${url}?skipstart&slidetiming&preset=colony-school${extra}`);
  await waitForResult(page, 180000);
  await page.waitForTimeout(1500);
  const colony = (await view(page)).settlements.find((s) => s.population > 0)!;
  const home: Tile = [colony.x, colony.y];
  const into: (Trial | null)[] = [];
  const far = ([x, y]: Tile) => {
    const [ax, ay] = tileOrigin(x, y);
    const [bx, by] = tileOrigin(...home);
    return Math.hypot(ax - bx, ay - by);
  };
  for (let tries = 0; into.length < Math.max(3, trials / 2) && tries < trials * 10; tries++) {
    const m = await view(page);
    if (!m.active) {
      await endTurn(page);
      continue;
    }
    const here = m.active;
    const dirs = Object.keys(DIRECTIONS) as Dir[];
    const inColony = here[0] === home[0] && here[1] === home[1];
    const sea = (t: Tile) => typeOf(m, t)?.land === false && empty(m, t);
    const d = inColony
      ? dirs.find((d) => sea(neighbour(here, d)))
      : (dirs.find((d) => neighbour(here, d).join() === home.join()) ??
        dirs
          .filter((d) => sea(neighbour(here, d)))
          .sort((a, b) => far(neighbour(here, a)) - far(neighbour(here, b)))
          .find((d) => far(neighbour(here, d)) < far(here)));
    if (!d) {
      await endTurn(page);
      continue;
    }
    const n = await page.evaluate(() => window.__maps);
    if (neighbour(here, d).join() === home.join()) into.push(await timed(page, pressed(page, KEYS[d])));
    else {
      await page.keyboard.press(KEYS[d]);
      await page.waitForFunction((n) => window.__maps > n, n, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    if (same(m, await view(page))) await endTurn(page);
  }
  report('into a colony', into, frameMs);
}

const site = await serveDist();
let failed = false;
for (const name of browserNames()) {
  const browser = await launchBrowser(name);
  console.log(`${name} ${browser.version()}`);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await run(page, site.url);
  } catch (ex) {
    failed = true;
    console.log(`  ${name} failed: ${String(ex)}`);
  } finally {
    await browser.close();
  }
}
site.close();
process.exit(failed ? 1 : 0);
