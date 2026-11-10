// Water comparisons (#409), against dist/. --variants Default,A,B,C,D,E uses the live playground.
// --video records each requested spot in split view, then trims five-second webm clips with ffmpeg.
// --still freezes terrain for baseline pixel comparisons. --extra '&clip=1' adds to the page's query. --headed supports Firefox under Xvfb.
// --rivers adds the playground's discovered minor bend, major river, minor-to-major join and delta.
// DEV_VARIANT=web ./dev.sh node ui/scripts/water-shots.ts --variants Default,A,B,C,D,E
//   --out .cache/water-shots/409-lolo --browsers chromium,firefox --themes parchment,dark
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

type Hook = {
  ready(): Promise<unknown>;
  variant(name: string): Promise<unknown>;
  jump(x: number, y: number, zoom: number): void;
  split(fraction: number): void;
  spots(): Record<string, [number, number][]>;
  renderer(): string;
};
declare global {
  interface Window {
    fcWaterPlayground: Hook;
  }
}
const variants = opt('variants', '').split(',').filter(Boolean);
const tilesets = variants.length ? ['freecol-plus'] : opt('tilesets', 'freecol,freecol-plus').split(',');
const themes = opt('themes', 'parchment,dark').split(',');
const spots = opt('spots', '100,52;99,66;101,48;88,15;104,41')
  .split(';')
  .filter(Boolean)
  .map((s) => s.split(',').map(Number) as [number, number]);
const zooms = opt('zooms', '1,2').split(',').map(Number);
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const video = process.argv.includes('--video');
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
        const context = await browser.newContext({
          viewport: { width: vw, height: vh },
          deviceScaleFactor: 1,
          ...(video ? { recordVideo: { dir: out, size: { width: vw, height: vh } } } : {}),
        });
        const page = await context.newPage();
        const recorded = Date.now();
        const clips: { file: string; from: number }[] = [];
        await answerDialogs(page);
        page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
        page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('[water]')) && console.log(m.text()));
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
        await page.goto(
          `${server.url}?skipstart&preset=pan-large${variants.length ? '&tileset=freecol-plus&playground=water&water=A' : ''}${opt('extra', '')}`,
        );
        const ready = await waitForResult(page, 240000);
        if (ready.status === 'failed') throw new Error(`${name}: game did not start: ${ready.error}`);
        if (variants.length) {
          await page.waitForFunction(() => !!window.fcWaterPlayground, null, { timeout: 60000 });
          await page.evaluate(() => window.fcWaterPlayground.ready());
          await page.locator('.wp').evaluate((el) => el.classList.add('min'));
        }
        await page.waitForTimeout(1500);
        const box = (await page.locator('#map canvas').boundingBox())!;
        const found = variants.length ? await page.evaluate(() => window.fcWaterPlayground.spots()) : {};
        const locations = [...spots];
        if (process.argv.includes('--climates'))
          for (const climate of ['cold', 'tropical']) {
            const spot = found[climate]?.[0];
            if (!spot) throw new Error(`No ${climate} coast found`);
            console.log(`${climate} coast: ${spot.join(',')}`);
            locations.push(spot);
          }
        if (process.argv.includes('--rivers'))
          for (const kind of ['minor river bend', 'major river', 'minor into major', 'delta']) {
            const spot = found[kind]?.[0];
            if (!spot) throw new Error(`No ${kind} found`);
            console.log(`${kind}: ${spot.join(',')}`);
            locations.push(spot);
          }
        const renderer = variants.length
          ? await page.evaluate(() => window.fcWaterPlayground.renderer())
          : ready.renderer;
        const gl = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no WebGL2';
        });
        console.log(`${name} ${theme}: ${renderer}; ${gl}`);
        for (const variant of variants.length ? variants : [tileset]) {
          if (variants.length) await page.evaluate((name) => window.fcWaterPlayground.variant(name), variant);
          const tag = `${label ? `${label}-` : ''}${variant}-${name}-${theme}${renderer === 'flipbook fallback' ? '-fallback' : ''}`;
          for (const spot of locations) {
            if (!variants.length) {
              await page.evaluate(([x, y]) => window.fcReveal!(x < 100 ? x + 60 : x - 60, y), spot);
              await page.waitForTimeout(300);
              await page.evaluate(([x, y]) => window.fcReveal!(x, y), spot);
            }
            let wheelAt = 0;
            for (const zoom of video ? [1] : zooms) {
              if (variants.length)
                await page.evaluate(([x, y, z]) => window.fcWaterPlayground.jump(x, y, z), [...spot, zoom]);
              else {
                const steps = zoom === 2 ? 2 : 0;
                for (let i = 0; i < Math.abs(steps - wheelAt); i++) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await page.mouse.wheel(0, steps > wheelAt ? -100 : 100);
                  await page.waitForTimeout(250);
                }
                wheelAt = steps;
              }
              if (variants.length)
                await page.evaluate(
                  (split) => window.fcWaterPlayground.split(split),
                  video ? 0.5 : Number(opt('split', '0')),
                );
              await page.mouse.move(0, 0);
              await page.waitForTimeout(1200);
              const file = path.join(out, `${tag}-${spot.join('_')}-zoom${zoom}.${video ? 'webm' : 'png'}`);
              if (video) {
                clips.push({ file, from: (Date.now() - recorded) / 1000 });
                await page.waitForTimeout((secs + 0.5) * 1000);
              } else await page.screenshot({ path: file, clip: { x: 0, y: 0, width: box.x + box.width, height: vh } });
              results.push({
                file: path.relative(process.cwd(), file),
                variant,
                browser: name,
                theme,
                spot,
                zoom,
                renderer,
                gl,
              });
              console.log(`${tag} ${spot.join(',')} zoom ${zoom} -> ${file}`);
            }
            if (!variants.length && wheelAt) {
              for (let i = 0; i < wheelAt; i++) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.wheel(0, 100);
                await page.waitForTimeout(250);
              }
            }
          }
        }
        await context.close();
        if (video) {
          const raw = await page.video()!.path();
          for (const clip of clips) {
            const cut = spawnSync(
              ffmpeg,
              [
                '-y',
                '-loglevel',
                'error',
                '-ss',
                String(clip.from),
                '-i',
                raw,
                '-t',
                String(secs),
                '-c:v',
                'libvpx-vp9',
                '-deadline',
                'realtime',
                '-cpu-used',
                '6',
                clip.file,
              ],
              { stdio: 'inherit' },
            );
            if (cut.status !== 0)
              throw new Error(`ffmpeg failed: ${cut.error ?? cut.status}; raw recording retained at ${raw}`);
          }
          await page.video()!.delete();
        }
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
