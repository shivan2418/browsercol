// Screenshots and short recordings of the map's water in each Tileset, for the owner to compare the look (#409): at
// coasts, a lake and the high seas of the pan-large map, at zoom 1 and zoomed in, in light and dark UI. Each shot is
// .cache/water-shots/<tileset>-<browser>-<theme>-<spot>-<view>.png; with --video, a few seconds of the water moving at
// the first spot, .cache/water-shots/<tileset>-<browser>-<theme>.webm.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/water-shots.ts [--browsers chromium,firefox] [--tilesets freecol,freecol-plus]
//     [--themes parchment,dark] [--spots 101,42;99,66] [--size 1366x768] [--video] [--secs 4] [--gpu]
// Firefox draws WebGL here only with webgl.force-enabled (headless, no GPU); without WebGL, PixiJS's Canvas renderer
// draws FreeCol's frames in either Tileset.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const tilesets = opt('tilesets', 'freecol,freecol-plus').split(',');
const themes = opt('themes', 'parchment,dark').split(',');
const spots = opt('spots', '101,42;99,66;9,58')
  .split(';')
  .filter(Boolean)
  .map((s) => s.split(',').map(Number) as [number, number]);
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const video = process.argv.includes('--video');
const secs = Number(opt('secs', '4'));
const gpu = process.argv.includes('--gpu');
/** The views: the wheel steps from zoom 1 (in is +). */
const VIEWS: [string, number][] = [
  ['zoom1', 0],
  ['zoomin', 1],
];
const out = path.resolve(import.meta.dirname, '../../.cache/water-shots');
fs.mkdirSync(out, { recursive: true });
const server = await serveDist();
const results: string[] = [];

for (const name of browserNames('chromium,firefox')) {
  const browser = await playwright[name].launch({
    ...(name === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } } : {}),
    args:
      name === 'chromium' && gpu
        ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
        : [],
  });
  for (const theme of themes)
    for (const tileset of tilesets) {
      const context = await browser.newContext({
        viewport: { width: vw, height: vh },
        deviceScaleFactor: 1,
        ...(video ? { recordVideo: { dir: out, size: { width: vw, height: vh } } } : {}),
      });
      const page = await context.newPage();
      await answerDialogs(page);
      page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
      page.on('console', (m) => m.type() === 'error' && console.log(`${name}: ${m.text().slice(0, 300)}`));
      await page.addInitScript(
        ([tileset, theme]) => localStorage.setItem('freecol.prefs', JSON.stringify({ tileset, palette: theme })),
        [tileset, theme],
      );
      await page.goto(`${server.url}?skipstart&preset=pan-large`);
      const ready = await waitForResult(page, 240000);
      if (ready.status === 'failed') throw new Error(`${name}: the game did not start: ${ready.error}`);
      await page.waitForTimeout(2000);
      const canvas = page.locator('#map canvas');
      const box = (await canvas.boundingBox())!;
      const wheel = async (steps: number) => {
        for (let i = 0; i < Math.abs(steps); i++) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, steps > 0 ? -100 : 100);
          await page.waitForTimeout(250);
        }
        await page.mouse.move(0, 0);
      };
      const tag = `${tileset}-${name}-${theme}`;
      let filmed = false;
      for (const spot of spots) {
        await page.evaluate(([x, y]) => window.fcReveal!(x, y), spot);
        let at = 0;
        for (const [view, steps] of VIEWS) {
          await wheel(steps - at);
          at = steps;
          await page.waitForTimeout(1200);
          const file = path.join(out, `${tag}-${spot.join('_')}-${view}.png`);
          await page.screenshot({ path: file });
          results.push(
            `${tag} ${spot.join(',')} ${view}: renderer ${ready.renderer} -> ${path.relative(process.cwd(), file)}`,
          );
        }
        await wheel(-at);
        if (video && !filmed) {
          // The water moving at the first spot, zoomed in.
          filmed = true;
          await wheel(1);
          await page.waitForTimeout(secs * 1000);
          await wheel(-1);
        }
      }
      await context.close();
      const v = page.video();
      if (v) {
        const file = path.join(out, `${tag}.webm`);
        await v.saveAs(file);
        await v.delete();
        results.push(`${tag}: video -> ${path.relative(process.cwd(), file)}`);
      }
    }
  await browser.close();
}
server.close();
console.log(results.join('\n'));
