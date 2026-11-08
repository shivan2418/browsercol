// Screenshots and short recordings of the map's water in each Tileset, for the owner to compare the look (#409): at
// a river mouth and coast, a lake with deltas, a corner, an island and a strait of the pan-large map, at zoom 1 and 2, in light and dark UI. Each shot is
// .cache/water-shots/<tileset>-<browser>-<theme>-<spot>-<view>.png; with --video, a few seconds of the water moving at
// the first spot, .cache/water-shots/<tileset>-<browser>-<theme>.webm (the run says where in it the water's part is).
//   DEV_VARIANT=web ./dev.sh node ui/scripts/water-shots.ts [--browsers chromium,firefox] [--tilesets freecol,freecol-plus]
//     [--themes parchment,dark] [--spots 100,52;99,66] [--size 1366x768] [--video] [--secs 4] [--gpu] [--label NAME]
// Headless Firefox in the web image gets no WebGL, even with webgl.force-enabled, which is set for a machine where it
// would: PixiJS's Canvas renderer draws, and with it FreeCol's frames, in either Tileset (the shader water's fallback).
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const tilesets = opt('tilesets', 'freecol,freecol-plus').split(',');
const themes = opt('themes', 'parchment,dark').split(',');
const spots = opt('spots', '100,52;99,66;101,48;88,15;103,45')
  .split(';')
  .filter(Boolean)
  .map((s) => s.split(',').map(Number) as [number, number]);
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const video = process.argv.includes('--video');
const secs = Number(opt('secs', '4'));
const gpu = process.argv.includes('--gpu');
/** --label: a prefix for the files, to keep two builds' shots side by side. */
const label = opt('label', '');
/** The views: the wheel steps from zoom 1 (in is +). */
const VIEWS: [string, number][] = [
  ['zoom1', 0],
  ['zoom2', 2],
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
      /** When the recording started, and when the water's part of it did, in seconds into it. */
      const recorded = Date.now();
      let filmFrom = 0;
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
      const tag = `${label ? `${label}-` : ''}${tileset}-${name}-${theme}`;
      let filmed = false;
      for (const spot of spots) {
        // fcReveal scrolls only to a tile off the screen: a far tile first, so the spot comes to the middle.
        await page.evaluate(([x, y]) => window.fcReveal!(x < 100 ? x + 60 : x - 60, y), spot);
        await page.waitForTimeout(300);
        await page.evaluate(([x, y]) => window.fcReveal!(x, y), spot);
        let at = 0;
        for (const [view, steps] of VIEWS) {
          await wheel(steps - at);
          at = steps;
          await page.waitForTimeout(1200);
          const file = path.join(out, `${tag}-${spot.join('_')}-${view}.png`);
          // The map and the menu bar, without the debug side panel.
          await page.screenshot({ path: file, clip: { x: 0, y: 0, width: box.x + box.width, height: vh } });
          results.push(
            `${tag} ${spot.join(',')} ${view}: renderer ${ready.renderer} -> ${path.relative(process.cwd(), file)}`,
          );
        }
        await wheel(-at);
        if (video && !filmed) {
          // The water moving at the first spot, at zoom 1.
          filmed = true;
          await page.waitForTimeout(500);
          filmFrom = (Date.now() - recorded) / 1000;
          await page.waitForTimeout(secs * 1000);
        }
      }
      await context.close();
      const v = page.video();
      if (v) {
        const file = path.join(out, `${tag}.webm`);
        await v.saveAs(file);
        await v.delete();
        // The water moving starts filmFrom seconds in: ffmpeg -ss <it> -t <secs> cuts it out.
        results.push(`${tag}: video -> ${path.relative(process.cwd(), file)}, the water from ${filmFrom.toFixed(1)} s`);
      }
    }
  await browser.close();
}
server.close();
console.log(results.join('\n'));
