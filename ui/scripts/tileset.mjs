// Draws the map with the default Tileset and with the test Tileset
// (ui/tilesets/test, the page's ?tileset=test) in the built site, and counts
// the test Tileset's cyan unexplored tiles on the map canvas. Then shows a
// colony panel, as the client Engine sends one, and looks at the town hall's
// art, which the test Tileset replaces. Exits non-zero unless every browser
// finds the cyan tiles and the test town hall with the test Tileset and
// neither without.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.mjs [--browsers chromium,firefox]
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, waitForResult } from './common.mjs';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const browsers = browserNames();
/** The share of the map the unexplored tiles must at least cover at the start. */
const MIN_SHARE = 0.1;

/** The share of the map canvas's pixels that are exactly the test Tileset's cyan. */
async function cyanShare(page, url) {
  await page.goto(url);
  const result = await waitForResult(page, 120000);
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

/** A colony as the client Engine sends it (ColonyJson.java), with only a town hall. */
const colony = {
  id: 'colony:1',
  name: 'Test',
  at: [0, 0],
  ok: 'OK',
  population: {
    total: 'Total: 0',
    rebels: 'Rebels: 0',
    royalists: 'Royalists: 0',
    bonus: 'Bonus: 0',
    rebelPercent: 0,
    rebelShield: [],
    royalistShield: [],
  },
  buildings: [
    {
      id: 'building:1',
      type: 'model.building.townHall',
      name: 'Town Hall',
      keys: ['image.buildingicon.model.building.townHall'],
      site: false,
      capacity: 3,
      workers: [],
      production: null,
      upkeep: null,
    },
  ],
  tiles: [],
  production: [],
  warehouse: { title: 'Warehouse', capacity: 100, goods: [] },
  outside: { title: 'Outside Colony', units: [] },
  inPort: { title: 'In Port', units: [], selected: null, cargo: 'Cargo on carrier' },
  construction: null,
  nothing: '',
};

/** The file the colony panel shows for the town hall. dialogs.mjs closes the panel and keeps its images. */
async function townHall(page) {
  await page.evaluate((c) => window.fcShow('colony', JSON.stringify(c)), colony);
  const handle = await page.waitForFunction(
    () => (window.__pictures ?? []).filter((p) => p.kind === 'colony').at(-1),
    null,
    { timeout: 10000 },
  );
  const picture = await handle.jsonValue();
  if (!picture.loaded) throw new Error(`the town hall did not load: ${picture.src}`);
  return picture.src;
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  let line;
  try {
    const plain = await cyanShare(page, `${server.url}?skipstart`);
    const plainHall = await townHall(page);
    const test = await cyanShare(page, `${server.url}?skipstart&tileset=test`);
    const testHall = await townHall(page);
    await page.screenshot({ path: path.join(dist, `../.cache/tileset-${name}.png`) });
    const pct = (s) => `${(s * 100).toFixed(1)}%`;
    const testArt = (src) => src.includes('/test/');
    const ok =
      plain.share === 0 && test.share >= MIN_SHARE && !testArt(plainHall) && testArt(testHall) && errors.length === 0;
    failed ||= !ok;
    line =
      `${ok ? 'ok' : 'failed'}: cyan ${pct(plain.share)} of the map with the default Tileset, ` +
      `${pct(test.share)} with the test Tileset, renderer ${test.renderer}; ` +
      `town hall ${plainHall} with the default Tileset, ${testHall} with the test Tileset`;
  } catch (ex) {
    failed = true;
    line = `failed: ${await diagnose(ex)}`;
  }
  console.log(`${name} ${browser.version()}: ${line}${errors.length ? ', page errors: ' + errors.join('; ') : ''}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
