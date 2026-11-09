// What animating the rivers costs (#410): the map's water ticks on pan-large at a river spot, once with the water
// alone animating (graphics quality 10) and once with the rivers too (40), under CPU throttling. The difference of
// the two is the rivers'. Per run: the "map: water" time of each tick (the first cycle, which builds the frames, and
// after it), the frame intervals, and what the animated pictures hold ("map: pictures": frames kept, live pictures).
//   DEV_VARIANT=web ./dev.sh node ui/scripts/rivers-bench.ts [--throttle 4] [--spot 100,52] [--secs 12] [--zoom 0] [--size 1366x768]
// --reps N runs the pair N times (a busy machine is noisy). --zoom N: wheel steps in (+) or out (-) before measuring.
import { opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const throttle = Number(opt('throttle', '4'));
const spot = opt('spot', '100,52').split(',').map(Number);
const secs = Number(opt('secs', '12'));
const zoom = Number(opt('zoom', '0'));
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const server = await serveDist();
const browser = await playwright.chromium.launch();

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return `n=${xs.length} mean ${mean.toFixed(2)} ms, p95 ${(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2)}, max ${(s.at(-1) ?? 0).toFixed(2)}`;
};

const reps = Number(opt('reps', '1'));
for (const quality of Array.from({ length: reps }, () => [10, 40]).flat()) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await answerDialogs(page);
  page.on('pageerror', (e) => console.log(`page error: ${e}`));
  await page.addInitScript((q) => {
    localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.graphicsQuality': q } }));
    const w: any = window;
    w.__b = { water: [] as [number, number][], pics: [] as [number, number, number][], frames: [] as number[] };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'map: water') w.__b.water.push([e.startTime, e.duration]);
        if (e.name === 'map: pictures') w.__b.pics.push([e.startTime, (e as any).detail.kept, (e as any).detail.live]);
      }
    }).observe({ entryTypes: ['measure', 'mark'] });
    let last = 0;
    const tick = (t: number) => {
      if (last) w.__b.frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, quality);
  await page.goto(`${server.url}?skipstart&preset=pan-large`);
  const ready = await waitForResult(page, 240000);
  if (ready.status === 'failed') throw new Error(`the game did not start: ${ready.error}`);
  await page.waitForTimeout(2000);
  await page.evaluate(([x, y]) => (window as any).fcReveal(x, y), spot);
  const box = (await page.locator('#map canvas').boundingBox())!;
  for (let i = 0; i < Math.abs(zoom); i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, zoom > 0 ? -100 : 100);
    await page.waitForTimeout(250);
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Performance.enable');
  const metric = async (name: string) =>
    ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
  const [script0, task0] = [await metric('ScriptDuration'), await metric('TaskDuration')];
  const from = await page.evaluate(() => performance.now());
  await page.waitForTimeout(secs * 1000);
  const [script, task] = [(await metric('ScriptDuration')) - script0, (await metric('TaskDuration')) - task0];
  const b = await page.evaluate(() => (window as any).__b);
  const water = (b.water as [number, number][]).filter(([t]) => t >= from);
  const cycle = 21 * 125;
  const first = water.filter(([t]) => t < from + cycle + 1000).map(([, d]) => d);
  const rest = water.filter(([t]) => t >= from + cycle + 1000).map(([, d]) => d);
  const pics = (b.pics as [number, number, number][]).at(-1);
  const frames = (b.frames as number[]).slice(-Math.floor((secs * 1000) / 16));
  console.log(
    `quality ${quality} (${quality < 20 ? 'water only' : 'water and rivers'}), ${throttle}x, ${vw}x${vh}, zoom ${zoom}, spot ${spot.join(',')}:` +
      `\n  map: water, first cycle: ${stats(first)}\n  map: water, after:       ${stats(rest)}` +
      `\n  main thread over ${secs} s (throttled): script ${script.toFixed(0)} ms, all tasks ${task.toFixed(0)} ms` +
      `\n  frame interval:          ${stats(frames)}\n  pictures: ${pics ? `${pics[1]} frames kept, ${pics[2]} live` : 'none'}`,
  );
  await page.close();
}
await browser.close();
server.close();
