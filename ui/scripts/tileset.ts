// Draws the map with the default Tileset and with the test Tileset
// (ui/tilesets/test, the page's ?tileset=test) in the built site, and counts
// the test Tileset's cyan unexplored tiles on the map canvas. Then shows a
// colony panel, as the client Engine sends one, and looks at the town hall's
// art, which the test Tileset replaces. Last, picks FreeCol+ as the player
// does, in the stored preferences, and starts a game. Exits non-zero unless
// every browser finds the cyan tiles and the test town hall with the test
// Tileset and neither without, and the page loads FreeCol+'s manifest and
// starts a game without page errors. Also runs Chromium without WebGL (PixiJS's sprites path) through resizes.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.ts [--browsers chromium,firefox]
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';
import type { Page } from 'playwright-core';

const browsers = browserNames();
/** The share of the map the unexplored tiles must at least cover at the start. */
const MIN_SHARE = 0.1;

/** The share of the map canvas's pixels that are exactly the test Tileset's cyan. */
async function cyanShare(page: Page, url: string) {
  await page.goto(url);
  const result = await waitForResult(page, 120000);
  if (result.status !== 'finished') throw new Error(`${result.status}: ${result.error}`);
  // Turn messages open over the map; scripts/dialogs.ts closes them.
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 10000 });
  // A screenshot rather than reading the canvas, which WebGL may have cleared.
  const png = (await page.locator('#map canvas').screenshot()).toString('base64');
  const share = await page.evaluate(async (png: string) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d')!;
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
    size: 0,
    sizeChange: '+0',
    rebelPercent: 0,
    tip: {
      members: [
        ['Rebel:', '0', '0%'],
        ['Royalist:', '0', '100%'],
      ],
      liberty: [],
      bar: { keys: [], value: 32, step: 1, max: 200, text: '32+1/200 (Turns: 168)' },
      turns: [],
    },
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
      tip: { input: null, output: null, workers: [], breeding: null },
    },
  ],
  tiles: [],
  production: [],
  warehouse: { title: 'Warehouse', capacity: 100, goods: [] },
  outside: { title: 'Outside Colony', units: [] },
  inPort: { title: 'In Port', units: [], selected: null, cargo: 'Cargo on carrier' },
  construction: null,
  nothing: '',
  queue: {
    title: 'Build Queue',
    buildingsTitle: 'Buildings',
    unitsTitle: 'Units',
    showAll: 'Show all',
    queue: [],
    buildings: [],
    units: [],
    buy: null,
  },
};

/** The file the colony panel shows for the town hall. dialogs.ts closes the panel and keeps its images. */
async function townHall(page: Page) {
  await page.evaluate((c) => window.fcShow('colony', JSON.stringify(c)), colony);
  const handle = await page.waitForFunction(
    () => (window.__pictures ?? []).filter((p) => p.kind === 'colony').at(-1),
    null,
    { timeout: 10000 },
  );
  const picture = (await handle.jsonValue())!;
  if (!picture.loaded) throw new Error(`the town hall did not load: ${picture.src}`);
  return picture.src!;
}

/**
 * The map on PixiJS's sprites path, which a browser with no WebGL gets (#411): a Chromium launched without it draws a
 * game, and keeps drawing through resizes of its window, a zoom and a pan. A mask on a layer once did not survive the
 * first paint, and every resize after it threw. Run with the default Tileset and with the BrowserCol Tileset.
 */
async function withoutWebgl(url: string, prefs: object | null) {
  const browser = await launchBrowser('chromium', ['--disable-gpu', '--disable-3d-apis', '--disable-webgl']);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = collectPageErrors(page);
    await answerDialogs(page);
    if (prefs) await page.addInitScript((p) => localStorage.setItem('freecol.prefs', p), JSON.stringify(prefs));
    await page.goto(url);
    const result = await waitForResult(page, 120000);
    if (result.status !== 'finished') throw new Error(`${result.status}: ${result.error}`);
    if (!result.renderer?.includes('sprites')) throw new Error(`not the sprites path: renderer ${result.renderer}`);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 10000 });
    // Let the map paint, then change what it paints to.
    await page.waitForTimeout(500);
    for (const [width, height] of [
      [1000, 700],
      [1500, 950],
      [800, 600],
      [1400, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
    }
    const box = (await page.locator('#map canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 300);
    await page.keyboard.press('ArrowRight');
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    return result.renderer;
  } finally {
    await browser.close();
  }
}

const server = await serveDist();
let failed = false;
if (browsers.includes('chromium')) {
  for (const [what, prefs] of [
    ['the default Tileset', null],
    ['the BrowserCol Tileset', { tileset: 'browsercol' }],
  ] as const) {
    try {
      console.log(
        `ok: with no WebGL and ${what}, renderer ${await withoutWebgl(`${server.url}?skipstart`, prefs)}, the map survives resizes`,
      );
    } catch (ex) {
      failed = true;
      console.log(`failed: with no WebGL and ${what}: ${await diagnose(ex)}`);
    }
  }
}
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  let line: string;
  try {
    const plain = await cyanShare(page, `${server.url}?skipstart`);
    const plainHall = await townHall(page);
    const test = await cyanShare(page, `${server.url}?skipstart&tileset=test`);
    const testHall = await townHall(page);
    await page.screenshot({ path: path.join(dist, `../.cache/tileset-${name}.png`) });
    await page.evaluate(() => localStorage.setItem('freecol.prefs', JSON.stringify({ tileset: 'freecol-plus' })));
    const manifests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/art/') && r.url().endsWith('.json'))
        manifests.push(path.basename(new URL(r.url()).pathname));
    });
    const plus = await cyanShare(page, `${server.url}?skipstart`);
    await page.evaluate(() => localStorage.removeItem('freecol.prefs'));
    const pct = (s: number) => `${(s * 100).toFixed(1)}%`;
    const testArt = (src: string) => src.includes('/test/');
    const ok =
      plain.share === 0 &&
      test.share >= MIN_SHARE &&
      !testArt(plainHall) &&
      testArt(testHall) &&
      plus.share === 0 &&
      manifests.includes('freecol-plus.json') &&
      errors.length === 0;
    failed ||= !ok;
    line =
      `${ok ? 'ok' : 'failed'}: cyan ${pct(plain.share)} of the map with the default Tileset, ` +
      `${pct(test.share)} with the test Tileset, renderer ${test.renderer}; ` +
      `town hall ${plainHall} with the default Tileset, ${testHall} with the test Tileset; ` +
      `with FreeCol+ picked the page loaded ${manifests.join(', ') || 'no manifest'}`;
  } catch (ex) {
    failed = true;
    line = `failed: ${await diagnose(ex)}`;
  }
  console.log(`${name} ${browser.version()}: ${line}${errors.length ? ', page errors: ' + errors.join('; ') : ''}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
