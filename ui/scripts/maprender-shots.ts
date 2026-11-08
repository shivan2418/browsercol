// #407 step 1: the same view drawn by each map renderer (?maprender=), at zoom 1, zoomed out and zoomed in, saved as
// .cache/dialog-shots/407-<variant>-<browser>-<view>.png, with each compared to sprites' (today's) pixel by pixel.
// The water stands still (no terrain animation), so the pictures can match.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/maprender-shots.ts [--gpu] [--browsers chromium,firefox]
//     [--variants sprites,margin,chunks,tilemap] [--preset pan-large] [--size 1366x768]
// Firefox draws with WebGL here (FC_FIREFOX_WEBGL's way): it needs no Canvas 2D fallback for this.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const gpu = process.argv.includes('--gpu');
/** --webgl1: Chromium without WebGL 2, as an old GPU or driver has it; the shots are named webgl1. */
const webgl1 = process.argv.includes('--webgl1');
const variants = opt('variants', 'sprites,margin,chunks,tilemap').split(',');
const preset = opt('preset', 'pan-large');
const [vw, vh] = opt('size', '1366x768').split('x').map(Number);
const extra = opt('query', '');
/** --at X,Y: the tile to centre the view on first (fcReveal), rather than the active unit. */
const at = opt('at')?.split(',').map(Number) as [number, number] | undefined;
const out = path.resolve(import.meta.dirname, '../../.cache/dialog-shots');
fs.mkdirSync(out, { recursive: true });
/** Other presets than pan-large are named in the file names. */
const tagged = (preset === 'pan-large' ? '' : `${preset}-`) + (webgl1 ? 'webgl1-' : '');
const server = await serveDist();

/** Wheel steps: out (-) or in (+), each its own zoom step. */
const VIEWS: [string, number][] = [
  ['zoom1', 0],
  ['zoomout', -2],
  ['zoomin', 3],
];

const results: string[] = [];
for (const name of browserNames('chromium')) {
  const browser = await playwright[name].launch({
    args: [
      ...(name === 'chromium' && gpu
        ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu']
        : []),
      ...(name === 'chromium' && webgl1 ? ['--disable-webgl2'] : []),
    ],
  });
  const shots = new Map<string, Buffer>();
  for (const v of variants) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    await answerDialogs(page);
    page.on('pageerror', (e) => console.log(`${name} ${v}: page error: ${e}`));
    page.on(
      'console',
      (m) =>
        (m.type() === 'warning' || m.type() === 'error') &&
        console.log(`${name} ${v}: ${m.type()}: ${m.text().slice(0, 300)}`),
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        'freecol.prefs',
        JSON.stringify({ freecol: { 'model.option.useTerrainAnimations': false } }),
      ),
    );
    await page.goto(`${server.url}?skipstart&mapstats&preset=${preset}&maprender=${v}${extra ? '&' + extra : ''}`);
    const ready = await waitForResult(page, 240000);
    if (ready.status === 'failed') {
      console.log(`${name} ${v}: the game did not start: ${ready.error}`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(3000);
    if (at) {
      await page.evaluate(([x, y]) => (window as any).fcReveal(x, y), at);
      await page.waitForTimeout(1000);
    }
    const canvas = page.locator('#map canvas');
    const box = (await canvas.boundingBox())!;
    // The pointer off the map: no tile under it, no hover text.
    await page.mouse.move(0, 0);
    for (const [view, steps] of VIEWS) {
      for (let i = 0; i < Math.abs(steps); i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, steps > 0 ? -100 : 100);
        await page.waitForTimeout(250);
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(1500);
      const png = await canvas.screenshot();
      const file = path.join(out, `407-${v}-${name}-${tagged}${view}.png`);
      fs.writeFileSync(file, png);
      shots.set(`${v}:${view}`, png);
      const stats = await page.evaluate(() => {
        const s = (window as any).__mapStats;
        return s && { ...s.overdraw(), ...s.snapshot() };
      });
      results.push(
        `${name} ${v.padEnd(8)} ${view.padEnd(8)} renderer ${ready.renderer}; fill ${stats?.overdraw?.toFixed(2) ?? '-'}x, ${stats?.objects ?? '-'} objects, ${stats?.quads ?? '-'} quads, textures ${((stats?.textureBytes ?? 0) / 2 ** 20).toFixed(1)} MB, atlas ${((stats?.atlasBytes ?? 0) / 2 ** 20).toFixed(0)} MB, chunk textures ${((stats?.cacheBytes ?? 0) / 2 ** 20).toFixed(0)} MB -> ${path.relative(process.cwd(), file)}`,
      );
    }
    await page.close();
  }
  // Each variant against sprites, in the same browser: the share of pixels off by more than 24 in a channel.
  const page = await browser.newPage();
  for (const v of variants.filter((v) => v !== 'sprites'))
    for (const [view] of VIEWS) {
      const a = shots.get(`sprites:${view}`);
      const b = shots.get(`${v}:${view}`);
      if (!a || !b) continue;
      const d = await page.evaluate(
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
        [a.toString('base64'), b.toString('base64')],
      );
      if (!d) continue;
      const file = path.join(out, `407-${v}-${name}-${tagged}${view}-diff.png`);
      fs.writeFileSync(file, Buffer.from(d.png, 'base64'));
      results.push(
        `${name} ${v.padEnd(8)} ${view.padEnd(8)} vs sprites: ${(100 * d.off).toFixed(3)}% of pixels off by >24, max ${d.max} -> ${path.relative(process.cwd(), file)}`,
      );
    }
  await browser.close();
}
server.close();
console.log(results.join('\n'));
