// PROTOTYPE (#409 water playground): screenshots of the running dev server's water, for checking the playground.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/water-playground-shots.ts --url http://172.17.0.10:5175/
//     [--query 'playground=water'] [--spots 104,41;88,15 | --kinds cold,temperate,tropical,corner,island,strait,lake]
//     [--zooms 0,2] [--eval 'JS run in the page first'] [--label NAME] [--size 1366x768] [--crop 500]
// Writes .cache/water-playground/<label>-<spot>-z<zoom>.png, the middle of the map (--crop px square, 0 the whole).
import fs from 'node:fs';
import path from 'node:path';
import { opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';

const url = opt('url', 'http://172.17.0.10:5175/');
const query = opt('query', 'playground=water');
const kinds = opt('kinds', '');
const spotsOpt = opt('spots', '');
const zooms = opt('zooms', '1,2').split(',').map(Number);
const evalJs = opt('eval', '');
const label = opt('label', 'shot');
const crop = Number(opt('crop', '520'));
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const out = path.resolve(import.meta.dirname, '../../.cache/water-playground');
fs.mkdirSync(out, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const page = await context.newPage();
await answerDialogs(page);
page.on('pageerror', (e) => console.log(`page error: ${e}`));
page.on(
  'console',
  (m) => (m.type() === 'error' || m.text().startsWith('[water]')) && console.log(m.text().slice(0, 400)),
);
await page.addInitScript(() => localStorage.setItem('freecol.prefs', JSON.stringify({ tileset: 'freecol-plus' })));
await page.goto(`${url}?skipstart&preset=pan-large&tileset=freecol-plus&${query}`);
const ready = await waitForResult(page, 240000);
if (ready.status === 'failed') throw new Error(`the game did not start: ${ready.error}`);
await page.waitForFunction(() => !!(window as unknown as { fcWaterPlayground?: unknown }).fcWaterPlayground, null, {
  timeout: 60000,
});
await page.waitForTimeout(1500);
if (evalJs) {
  await page.evaluate(evalJs);
  await page.evaluate(() =>
    (window as unknown as { fcWaterPlayground: { ready(): Promise<unknown> } }).fcWaterPlayground.ready(),
  );
  await page.waitForTimeout(1500);
}
type Hook = { spots(): Record<string, [number, number][]>; jump(x: number, y: number, zoom: number): void };
const spots: [string, [number, number]][] = [];
if (spotsOpt)
  for (const s of spotsOpt.split(';').filter(Boolean))
    spots.push([s.replace(',', '_'), s.split(',').map(Number) as [number, number]]);
if (kinds) {
  const found = await page.evaluate(() => (window as unknown as { fcWaterPlayground: Hook }).fcWaterPlayground.spots());
  for (const k of kinds.split(',')) if (found[k]?.length) spots.push([k, found[k][0]]);
}
const canvas = page.locator('#map canvas');
const box = (await canvas.boundingBox())!;
for (const [name, [x, y]] of spots)
  for (const z of zooms) {
    await page.evaluate(
      ([x, y, z]) => (window as unknown as { fcWaterPlayground: Hook }).fcWaterPlayground.jump(x, y, z),
      [x, y, z],
    );
    await page.waitForTimeout(1500);
    const file = path.join(out, `${label}-${name}-z${z}.png`);
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.screenshot({
      path: file,
      clip: crop ? { x: cx - crop / 2, y: cy - crop / 2, width: crop, height: crop } : undefined,
    });
    console.log(`${name} (${x},${y}) z${z} -> ${path.relative(process.cwd(), file)}`);
    // --later N: a second shot N seconds on, to see how the water moved.
    const later = Number(opt('later', '0'));
    if (later) {
      await page.waitForTimeout(later * 1000);
      const file2 = file.replace(/\.png$/, `-t${later}.png`);
      await page.screenshot({
        path: file2,
        clip: crop ? { x: cx - crop / 2, y: cy - crop / 2, width: crop, height: crop } : undefined,
      });
      console.log(`  +${later} s -> ${path.relative(process.cwd(), file2)}`);
    }
  }
if (process.argv.includes('--full')) {
  const file = path.join(out, `${label}-full.png`);
  await page.screenshot({ path: file });
  console.log(`full -> ${file}`);
}
await browser.close();
