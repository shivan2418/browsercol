// Measures a middle-button drag's start (#420): what the page's JavaScript spends during short drags into new ground,
// the pointermove handler's time, and the frames' intervals at the start. Each of `--runs` drags is `--moves` moves of
// `--step` px at `--hz`, one after another (each into ground the last did not show), with a pause before each. The
// headless Chromium draws WebGL on the CPU (SwiftShader), so its frame times are mostly the GPU's work: the JS time
// (CDP Performance.getMetrics ScriptDuration) is the number to compare.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/drag-start.ts [--throttle 4] [--runs 6] [--hz 125] [--step 2] [--moves 100]
import { opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const throttle = Number(opt('throttle', '1'));
const runs = Number(opt('runs', '6'));
const hz = Number(opt('hz', '125'));
const step = Number(opt('step', '2'));
const nMoves = Number(opt('moves', '100'));
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);

const server = await serveDist();
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await answerDialogs(page);
await page.addInitScript(() => {
  const w: any = window;
  w.__d = { frames: [] as number[], cost: [] as number[], down: false };
  addEventListener('pointermove', () => (w.__t0 = performance.now()), { capture: true });
  addEventListener('pointerdown', () => (w.__d.down = true), { capture: true });
  const tick = (t: number) => {
    if (w.__d.down) w.__d.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.goto(`${server.url}?skipstart&preset=pan-large`);
const ready = await waitForResult(page, 240000);
if (ready.status === 'failed') throw new Error(`the game did not start: ${ready.error}`);
await page.waitForTimeout(3000);
// The handler time of each drag pointermove: a capture listener from the start, one at the end of the bubble.
await page.evaluate(() => {
  const w: any = window;
  addEventListener('pointermove', () => w.__d.down && w.__d.cost.push(performance.now() - w.__t0));
});
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
await cdp.send('Performance.enable');
const metrics = async () =>
  Object.fromEntries(
    ((await cdp.send('Performance.getMetrics')) as any).metrics.map((m: any) => [m.name, m.value]),
  ) as Record<string, number>;
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

const scripts: number[] = [];
const handlers: number[] = [];
let x = cx;
for (let r = 0; r < runs; r++) {
  await mouse('mouseMoved', x, cy, 0);
  await page.waitForTimeout(700);
  await page.evaluate(() => Object.assign((window as any).__d, { frames: [], cost: [], down: false }));
  const m0 = await metrics();
  await mouse('mousePressed', x, cy, 4);
  const sent: Promise<unknown>[] = [];
  const t0 = performance.now();
  for (let i = 1; i <= nMoves; i++) {
    const due = t0 + (i * 1000) / hz;
    while (performance.now() < due - 1) await new Promise((ok) => setTimeout(ok, 1));
    sent.push(mouse('mouseMoved', x + i * step, cy, 4));
  }
  await Promise.all(sent);
  await mouse('mouseReleased', x + nMoves * step, cy, 0);
  const m1 = await metrics();
  x += nMoves * step;
  const d = (await page.evaluate(() => (window as any).__d)) as { frames: number[]; cost: number[] };
  const script = (m1.ScriptDuration! - m0.ScriptDuration!) * 1000;
  const first = d.cost.slice(0, 5);
  const dts = d.frames.slice(0, 8).map((f, i, a) => (i ? Math.round(f - a[i - 1]!) : 0));
  scripts.push(script);
  handlers.push(...d.cost);
  console.log(
    `run ${r}: JS ${script.toFixed(0)} ms in ${((m1.Timestamp! - m0.Timestamp!) * 1000).toFixed(0)} ms; handler of the first 5 moves ${first.map((c) => c.toFixed(1)).join(' ')} ms; frame intervals ${dts.join(',')}`,
  );
}
const med = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;
console.log(
  `throttle ${throttle}x: median JS per drag ${med(scripts).toFixed(0)} ms, max ${Math.max(...scripts).toFixed(0)} ms; handler median ${med(handlers).toFixed(1)} ms, max ${Math.max(...handlers).toFixed(1)} ms`,
);
await browser.close();
server.close();
