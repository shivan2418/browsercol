// Screenshots of the map at fixed views, to compare one build's drawing with another's (#407): each view is saved
// as .cache/map-shots/<label>-<browser>-<preset>-<spot>-<view>.png and, with --baseline OTHER, compared pixel by
// pixel with OTHER's shot of the same view, the difference saved beside it as ...-diff.png.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/map-shots.ts --label after [--baseline before] [--gpu] [--dpr 2]
//     [--browsers chromium] [--preset pan-large] [--spots 45,60;120,40] [--size 1366x768] [--query k=v]
//     [--chromium-args "--disable-webgl"]
// The water stands still (no terrain animation), so the pictures can match. The views: zoom 1, zoomed out to 0.5,
// in to 1.5 and to 2, and far out to 0.25. --gpu draws on the GPU (dev.sh's docker run needs the render node).
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const label = opt('label', 'shot');
const baseline = opt('baseline');
const gpu = process.argv.includes('--gpu');
const dpr = Number(opt('dpr', '1'));
const preset = opt('preset', 'pan-large');
const spots = opt('spots', '')
  .split(';')
  .filter(Boolean)
  .map((s) => s.split(',').map(Number) as [number, number]);
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const extra = opt('query', '');
const chromiumArgs = opt('chromium-args', '').split(' ').filter(Boolean);
const out = path.resolve(import.meta.dirname, '../../.cache/map-shots');
fs.mkdirSync(out, { recursive: true });
const server = await serveDist();

/** Each view and the wheel steps to it from the one before: out (-) or in (+). */
const VIEWS: [string, number][] = [
  ['zoom1', 0],
  ['zoomout', -2],
  ['zoomin', 3],
  ['zoom2', 1],
  ['zoomfar', -5],
];

const results: string[] = [];
const fileOf = (l: string, browser: string, spot: string, view: string) =>
  path.join(out, `${l}-${browser}-${preset}${dpr === 1 ? '' : `-dpr${dpr}`}-${spot}-${view}.png`);

for (const name of browserNames('chromium')) {
  const browser = await playwright[name].launch({
    args: [
      ...(name === 'chromium' && gpu
        ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
        : []),
      ...(name === 'chromium' ? chromiumArgs : []),
    ],
  });
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  await answerDialogs(page);
  page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`${name}: ${m.text().slice(0, 300)}`));
  await page.addInitScript(() =>
    localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.useTerrainAnimations': false } })),
  );
  await page.goto(`${server.url}?skipstart&preset=${preset}${extra ? '&' + extra : ''}`);
  const ready = await waitForResult(page, 240000);
  if (ready.status === 'failed') throw new Error(`${name}: the game did not start: ${ready.error}`);
  await page.waitForTimeout(3000);
  const canvas = page.locator('#map canvas');
  const box = (await canvas.boundingBox())!;
  for (const spot of spots.length ? spots : [null]) {
    const spotName = spot ? spot.join('_') : 'start';
    if (spot) {
      await page.evaluate(([x, y]) => (window as any).fcReveal(x, y), spot);
      await page.waitForTimeout(1000);
    }
    for (const [view, steps] of VIEWS) {
      for (let i = 0; i < Math.abs(steps); i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, steps > 0 ? -100 : 100);
        await page.waitForTimeout(250);
      }
      // The pointer off the map: no tile under it, no hover text.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1500);
      const file = fileOf(label, name, spotName, view);
      fs.writeFileSync(file, await canvas.screenshot());
      results.push(`${name} ${spotName} ${view}: renderer ${ready.renderer} -> ${path.relative(process.cwd(), file)}`);
    }
    // Back to zoom 1 for the next spot.
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(250);
    }
  }
  await page.close();
  if (baseline) {
    // The share of pixels off by more than 24 in a channel, and the most any channel is off.
    const cmp = await browser.newPage();
    for (const spot of spots.length ? spots : [null])
      for (const [view] of VIEWS) {
        const spotName = spot ? spot.join('_') : 'start';
        const [a, b] = [fileOf(baseline, name, spotName, view), fileOf(label, name, spotName, view)];
        if (!fs.existsSync(a)) continue;
        const d = await cmp.evaluate(
          async ([a, b]) => {
            const img = async (s: string) => {
              const i = new Image();
              i.src = 'data:image/png;base64,' + s;
              await i.decode();
              const c = document.createElement('canvas');
              [c.width, c.height] = [i.width, i.height];
              const g = c.getContext('2d')!;
              g.drawImage(i, 0, 0);
              return g.getImageData(0, 0, i.width, i.height);
            };
            const [x, y] = [await img(a), await img(b)];
            if (x.width !== y.width || x.height !== y.height) return null;
            const out = document.createElement('canvas');
            [out.width, out.height] = [x.width, x.height];
            const og = out.getContext('2d')!;
            const diff = og.createImageData(x.width, x.height);
            let off = 0;
            let max = 0;
            for (let i = 0; i < x.data.length; i += 4) {
              const m = Math.max(
                Math.abs(x.data[i] - y.data[i]),
                Math.abs(x.data[i + 1] - y.data[i + 1]),
                Math.abs(x.data[i + 2] - y.data[i + 2]),
              );
              max = Math.max(max, m);
              if (m > 24) off++;
              diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = Math.min(255, m * 4);
              diff.data[i + 3] = 255;
            }
            og.putImageData(diff, 0, 0);
            return { off: off / (x.width * x.height), max, png: out.toDataURL('image/png').split(',')[1] };
          },
          [fs.readFileSync(a).toString('base64'), fs.readFileSync(b).toString('base64')],
        );
        if (!d) continue;
        const file = b.replace(/\.png$/, '-diff.png');
        fs.writeFileSync(file, Buffer.from(d.png, 'base64'));
        results.push(
          `${name} ${spotName} ${view} vs ${baseline}: ${(100 * d.off).toFixed(3)}% of pixels off by >24, max ${d.max} -> ${path.relative(process.cwd(), file)}`,
        );
      }
  }
  await browser.close();
}
server.close();
console.log(results.join('\n'));
