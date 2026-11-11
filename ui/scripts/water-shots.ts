// Water comparisons (#409, #411), against dist/: shots of spots on pan-large in each Tileset, browser and theme.
// --still freezes the terrain's animation, for pixel comparisons between builds. --video records each spot instead,
// at zoom 1, and keeps the last --secs seconds of it as a webm clip, once the map has settled there; --gif also makes
// a gif of the map's middle from each clip. --gpu draws Chromium on a real GPU (the container must see one), which
// records without dropped or blank frames. --extra '&x=1' adds to the page's query; --headed runs Firefox under Xvfb.
// DEV_VARIANT=web ./dev.sh node ui/scripts/water-shots.ts --tilesets freecol,browsercol
//   --out .cache/water-shots/409 --browsers chromium,firefox --themes parchment,dark
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const tilesets = opt('tilesets', 'freecol,browsercol').split(',');
const themes = opt('themes', 'parchment,dark').split(',');
const spots = opt('spots', '100,52;99,66;101,48;88,15;104,41')
  .split(';')
  .filter(Boolean)
  .map((s) => s.split(',').map(Number) as [number, number]);
const zooms = opt('zooms', '1,2').split(',').map(Number);
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const video = process.argv.includes('--video');
const gif = process.argv.includes('--gif');
const secs = Number(opt('secs', '5'));
// The web image has Playwright's encoder, not a system ffmpeg.
const ffmpeg =
  fs.globSync(path.resolve(playwright.chromium.executablePath(), '../../../ffmpeg-*/ffmpeg-linux'))[0] ?? 'ffmpeg';
const gpu = process.argv.includes('--gpu');
const still = process.argv.includes('--still');
const label = opt('label', '');
const out = path.resolve(opt('out', '.cache/water-shots'));
fs.mkdirSync(out, { recursive: true });
const server = await serveDist();
const results: object[] = [];

const run = (args: string[]) => {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.error ?? r.status}`);
};

/** A page with the game started on pan-large in a Tileset and theme, recording a video if asked. */
async function open(browser: Browser, name: string, tileset: string, theme: string) {
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: out, size: { width: vw, height: vh } } } : {}),
  });
  const page = await context.newPage();
  await answerDialogs(page);
  page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
  page.on('console', (m) => m.type() === 'error' && console.log(m.text()));
  await page.addInitScript(
    ({ tileset, theme, still }) =>
      localStorage.setItem(
        'freecol.prefs',
        JSON.stringify({
          tileset,
          palette: theme,
          ...(still ? { freecol: { 'model.option.useTerrainAnimations': false } } : {}),
        }),
      ),
    { tileset, theme, still },
  );
  await page.goto(`${server.url}?skipstart&preset=pan-large${opt('extra', '')}`);
  const ready = await waitForResult(page, 240000);
  if (ready.status === 'failed') throw new Error(`${name}: game did not start: ${ready.error}`);
  await page.waitForTimeout(1500);
  return { context, page, renderer: ready.renderer };
}

/** Centre the map on a spot (from far off first, so the scene there is drawn afresh), at zoom 1 or 2. */
async function goTo(page: Page, [x, y]: [number, number], zoom: number) {
  await page.evaluate(([x, y]) => window.fcReveal!(x < 100 ? x + 60 : x - 60, y), [x, y]);
  await page.waitForTimeout(300);
  await page.evaluate(([x, y]) => window.fcReveal!(x, y), [x, y]);
  const box = (await page.locator('#map canvas').boundingBox())!;
  for (let i = 0; i < (zoom === 2 ? 2 : 0); i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(250);
  }
  await page.mouse.move(0, 0);
  return box;
}

for (const name of browserNames('chromium,firefox')) {
  const browser = await playwright[name].launch({
    headless: !process.argv.includes('--headed'),
    ...(name === 'firefox'
      ? {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.disabled': false,
            'gfx.webrender.software': true,
            'webgl.enable-webgl2': true,
          },
        }
      : {}),
    args:
      name === 'chromium'
        ? gpu
          ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
          : ['--enable-unsafe-swiftshader']
        : [],
  });
  try {
    for (const theme of themes)
      for (const tileset of tilesets) {
        const tag = `${label ? `${label}-` : ''}${tileset}-${name}-${theme}`;
        if (video) {
          // A recording a spot: what the recording starts with (the game starting) is cut away, so its end is kept.
          for (const spot of spots) {
            const { context, page, renderer } = await open(browser, name, tileset, theme);
            await goTo(page, spot, 1);
            await page.waitForTimeout((secs + 4) * 1000);
            await context.close();
            const raw = await page.video()!.path();
            const file = path.join(out, `${tag}-${spot.join('_')}.webm`);
            run(['-sseof', String(-(secs + 1)), '-i', raw, '-t', String(secs), '-c:v', 'libvpx-vp9', file]);
            if (gif)
              run([
                '-i',
                file,
                '-vf',
                'crop=600:400:150:120,fps=15,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
                '-loop',
                '0',
                file.replace(/\.webm$/, '.gif'),
              ]);
            await page.video()!.delete();
            results.push({ file: path.relative(process.cwd(), file), tileset, browser: name, theme, spot, renderer });
            console.log(`${tag} ${spot.join(',')} -> ${file}`);
          }
          continue;
        }
        const { context, page, renderer } = await open(browser, name, tileset, theme);
        const gl = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no WebGL2';
        });
        console.log(`${name} ${theme}: ${renderer}; ${gl}`);
        for (const spot of spots)
          for (const zoom of zooms) {
            const box = await goTo(page, spot, zoom);
            await page.waitForTimeout(1200);
            const file = path.join(out, `${tag}-${spot.join('_')}-zoom${zoom}.png`);
            await page.screenshot({ path: file, clip: { x: 0, y: 0, width: box.x + box.width, height: vh } });
            results.push({
              file: path.relative(process.cwd(), file),
              tileset,
              browser: name,
              theme,
              spot,
              zoom,
              renderer,
              gl,
            });
            console.log(`${tag} ${spot.join(',')} zoom ${zoom} -> ${file}`);
            for (let i = 0; i < (zoom === 2 ? 2 : 0); i++) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.wheel(0, 100);
              await page.waitForTimeout(250);
            }
          }
        await context.close();
      }
  } finally {
    await browser.close();
  }
}
server.close();
fs.writeFileSync(
  path.join(out, `${label || (video ? 'videos' : 'shots')}-manifest.json`),
  JSON.stringify(results, null, 2),
);
