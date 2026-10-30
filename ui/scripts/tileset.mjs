// Draws the map with the default Tileset and with the test Tileset
// (ui/tilesets/test, the page's ?tileset=test) in the built site, and counts
// the test Tileset's cyan unexplored tiles on the map canvas. Exits non-zero
// unless every browser finds them with the test Tileset and none without.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.mjs [--browsers chromium,firefox]
import path from 'node:path';
import { createRequire } from 'node:module';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const browsers = opt('browsers', 'chromium,firefox').split(',');
/** The share of the map the unexplored tiles must at least cover at the start. */
const MIN_SHARE = 0.1;

/** The share of the map canvas's pixels that are exactly the test Tileset's cyan. */
async function cyanShare(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.fcResult, null, { timeout: 120000 });
  const result = await page.evaluate(() => window.fcResult);
  if (result.status !== 'finished') throw new Error(`${result.status}: ${result.error}`);
  // Turn messages open over the map; scripts/dialogs.mjs closes them.
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 10000 });
  // A screenshot rather than reading the canvas, which WebGL may have cleared.
  const png = (await page.locator('#map canvas').screenshot()).toString('base64');
  const share = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] === 0 && px[i + 1] === 255 && px[i + 2] === 255) n++;
    return n / (px.length / 4);
  }, png);
  return { share, renderer: result.renderer };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await answerDialogs(page);
  let line;
  try {
    const plain = await cyanShare(page, server.url);
    const test = await cyanShare(page, `${server.url}?tileset=test`);
    await page.screenshot({ path: path.join(dist, `../.cache/tileset-${name}.png`) });
    const pct = (s) => `${(s * 100).toFixed(1)}%`;
    const ok = plain.share === 0 && test.share >= MIN_SHARE && errors.length === 0;
    failed ||= !ok;
    line =
      `${ok ? 'ok' : 'failed'}: cyan ${pct(plain.share)} of the map with the default Tileset, ` +
      `${pct(test.share)} with the test Tileset, renderer ${test.renderer}`;
  } catch (ex) {
    failed = true;
    line = `failed: ${String(ex)}`;
  }
  console.log(`${name} ${browser.version()}: ${line}${errors.length ? ', page errors: ' + errors.join('; ') : ''}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
