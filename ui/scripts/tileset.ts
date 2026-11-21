// Draws the map with the default Tileset and with the test Tileset
// (ui/tilesets/test, the page's ?tileset=test) in the built site, and counts
// the test Tileset's cyan unexplored tiles on the map canvas. Then shows a
// colony panel, as the client Engine sends one, and looks at the town hall's
// art, which the test Tileset replaces. Last, picks FreeCol+ as the player
// does, in the stored preferences, and starts a game. Exits non-zero unless
// every browser finds the cyan tiles and the test town hall with the test
// Tileset and neither without, and the page loads FreeCol+'s manifest and
// starts a game without page errors. Also runs Chromium without WebGL (PixiJS's sprites path) through resizes.
// Last, the Tilesets by Map view (#535): the player picks FreeCol+ for Isometric in the Preferences window, switching
// the Map view to Top-down switches to the built-in Top-down Tileset (FreeCol's units and colonies still shown) and
// back to FreeCol+, a reload keeps the pick, and the debug test layer (a magenta marker at each tile's middle) draws
// in both views and not at all when off. Shots in .cache/tileset-view-<browser>-<what>.png.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/tileset.ts [--browsers chromium,firefox]
import fs from 'node:fs';
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

/** How many pixels of the map canvas are the debug test layer's magenta, as a shot of it. */
async function magenta(page: Page) {
  const png = (await page.locator('#map canvas').screenshot()).toString('base64');
  return page.evaluate(async (png: string) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 235 && px[i + 1] < 25 && px[i + 2] > 235) n++;
    return n;
  }, png);
}

/** The manifests the page asks for under art/, in order, from now on. */
function manifestsOf(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes('/art/') && u.pathname.endsWith('.json')) seen.push(path.basename(u.pathname));
  });
  return seen;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const fcTileset = (page: Page, keys: string[] = []) => page.evaluate((k) => window.fcTileset!(k), keys);

/** Pick the Map view in the debug side panel's switch, as topdown.ts does, and wait for the art to settle. */
async function pickView(page: Page, kind: 'isometric' | 'topdown') {
  await page.selectOption('#map-view', kind);
  await page.waitForFunction((k) => window.fcTileset?.().view === k, kind);
  await sleep(2000);
}

/** Open the Preferences window from the Game menu, as a player does. */
async function openPreferences(page: Page) {
  await page.getByRole('menuitem', { name: 'Game', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Preferences/ }).click();
}

/** The Tilesets by Map view: see the head of this file. */
async function byView(name: string, url: string) {
  const out = path.join(dist, '../.cache');
  fs.mkdirSync(out, { recursive: true });
  const browser = await launchBrowser(name as 'chromium' | 'firefox');
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  const manifests = manifestsOf(page);
  const problems: string[] = [];
  const check = (what: string, ok: boolean) => {
    if (!ok) problems.push(what);
  };
  const shot = async (what: string) => {
    await page.mouse.move(0, 0);
    fs.writeFileSync(path.join(out, `tileset-view-${name}-${what}.png`), await page.screenshot());
  };
  try {
    // The latest map the Engine sent, as topdown.ts keeps it.
    await page.addInitScript(() => {
      let inner: ((name: string, detail: string) => unknown) | undefined;
      Object.defineProperty(window, 'fcClientEvent', {
        configurable: true,
        get: () => inner,
        set: (f: (name: string, detail: string) => unknown) => {
          inner = (n: string, detail: string) => {
            if (n === 'map' || n === 'gameStarted') window.__map = JSON.parse(detail);
            return f(n, detail);
          };
        },
      });
    });
    // Still terrain, and the debug side panel (and its Map view switch).
    await page.addInitScript(() => {
      if (!localStorage.getItem('freecol.prefs'))
        localStorage.setItem(
          'freecol.prefs',
          JSON.stringify({ freecol: { 'model.option.useTerrainAnimations': false } }),
        );
    });
    await page.goto(url);
    const result = await waitForResult(page, 900000);
    if (result.status !== 'finished') throw new Error(`${result.status}: ${result.error}`);
    await page.waitForFunction(() => window.__map?.ourTurn, null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 30000 });
    await sleep(1500);
    const first = await fcTileset(page);
    check(
      `the start is ${JSON.stringify(first)}, not FreeCol in Isometric`,
      first.view === 'isometric' && first.tileset === 'freecol',
    );
    // Top-down offers no FreeCol+ and the Isometric view no Top-down: pick FreeCol+ in the Preferences window.
    await openPreferences(page);
    await page.locator('#preferences').waitFor({ timeout: 20000 });
    const row = page.locator('[data-pref=tilesets] [role=combobox]');
    await row.click();
    await page.locator('.ui-select-item').first().waitFor();
    const offered = await page.locator('.ui-select-item').allTextContents();
    check(`the Isometric view offers ${offered.join(', ')}`, offered.join() === 'FreeCol,FreeCol+,BrowserCol');
    await page
      .locator('.ui-select-item')
      .filter({ hasText: /^FreeCol\+$/ })
      .click();
    await page.locator('[data-prefs-ok]').click();
    await page.locator('#preferences').waitFor({ state: 'detached', timeout: 20000 });
    await sleep(2000);
    const plus = await fcTileset(page);
    check(
      `picking FreeCol+ gave ${JSON.stringify(plus)}`,
      plus.tileset === 'freecol-plus' && plus.manifest === 'freecol-plus.json',
    );
    check(`FreeCol+'s manifest was loaded at once (${manifests.join()})`, manifests.includes('freecol-plus.json'));
    // The debug test layer, in Isometric.
    check('the test layer is off at the start: no magenta', (await magenta(page)) === 0);
    await page.locator('#tile-art-markers').check();
    await sleep(1500);
    const isoMarks = await magenta(page);
    check(`the test layer draws in Isometric (${isoMarks} px)`, isoMarks > 200);
    await shot('isometric-freecol-plus');
    // Top-down: the built-in Tileset, with FreeCol's units and colonies.
    await pickView(page, 'topdown');
    const top = await page.evaluate(() => {
      const m = window.__map;
      const mine = m.units.filter((u) => u.keys.length).map((u) => u.keys);
      return {
        units: mine.slice(0, 1).flat(),
        colony: m.settlements
          .filter((s) => s.population >= 0)
          .slice(0, 1)
          .flatMap((s) => s.keys),
      };
    });
    const topdown = await fcTileset(page, [...top.units, ...top.colony]);
    check(
      `Top-down is ${JSON.stringify({ ...topdown, has: undefined })}, not the built-in Tileset`,
      topdown.view === 'topdown' && topdown.tileset === 'topdown' && topdown.manifest === null,
    );
    check("the page asked for FreeCol's own art.json for Top-down", manifests.includes('art.json'));
    check(
      `Top-down has FreeCol's art for its units and colonies (${top.units.length + top.colony.length} keys)`,
      top.units.length > 0 && topdown.has.some(Boolean) && top.colony.length > 0,
    );
    const topMarks = await magenta(page);
    check(`the test layer draws in Top-down (${topMarks} px)`, topMarks > 200);
    await shot('topdown');
    await page.locator('#tile-art-markers').uncheck();
    await sleep(1500);
    check('with the test layer off nothing of it is drawn in Top-down', (await magenta(page)) === 0);
    // The Preferences window offers Top-down only its own Tileset.
    await openPreferences(page);
    await page.locator('#preferences').waitFor({ timeout: 20000 });
    await page.locator('[data-pref=tilesets] [role=combobox]').click();
    await page.locator('.ui-select-item').first().waitFor();
    const topOffered = await page.locator('.ui-select-item').allTextContents();
    check(`the Top-down view offers ${topOffered.join(', ')}`, topOffered.join() === 'Top-down (built in)');
    await page.keyboard.press('Escape');
    await page.locator('[data-prefs-ok]').click();
    await page.locator('#preferences').waitFor({ state: 'detached', timeout: 20000 });
    // Back: the last Isometric Tileset, FreeCol+.
    await pickView(page, 'isometric');
    const back = await fcTileset(page);
    check(
      `back in Isometric the Tileset is ${back.tileset}, not FreeCol+`,
      back.tileset === 'freecol-plus' && back.manifest === 'freecol-plus.json',
    );
    // A reload keeps both: Isometric starts with FreeCol+, and Top-down switches to its own.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('freecol.prefs')!).tilesets);
    check(
      `the stored Tilesets are ${JSON.stringify(stored)}`,
      stored?.isometric === 'freecol-plus' && stored?.topdown === 'topdown',
    );
    manifests.length = 0;
    await page.goto(url);
    const again = await waitForResult(page, 900000);
    if (again.status !== 'finished') throw new Error(`${again.status}: ${again.error}`);
    await page.waitForFunction(() => window.__map?.ourTurn, null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 30000 });
    const reloaded = await fcTileset(page);
    check(
      `after a reload Isometric has ${reloaded.tileset}`,
      reloaded.tileset === 'freecol-plus' && manifests.includes('freecol-plus.json'),
    );
    await pickView(page, 'topdown');
    check('after a reload Top-down has its own Tileset', (await fcTileset(page)).tileset === 'topdown');
    await shot('topdown-after-reload');
    if (errors.length) problems.push(`page errors: ${errors.join('; ')}`);
  } catch (ex) {
    problems.push(await diagnose(ex));
  }
  await browser.close();
  return problems;
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const problems = await byView(name, `${server.url}?skipstart&debug&preset=colony-step`);
  failed ||= problems.length > 0;
  console.log(
    problems.length
      ? `failed: ${name}, Tilesets by Map view: ${problems.join(' | ')}`
      : `ok: ${name}, Tilesets by Map view: FreeCol+ picked in Isometric, the built-in Tileset in Top-down with FreeCol's units and colonies, both kept over a reload, the test layer in both views`,
  );
}
if (browsers.includes('chromium')) {
  for (const [what, prefs] of [
    ['the default Tileset', null],
    ['the BrowserCol Tileset', { tilesets: { isometric: 'browsercol' } }],
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
    await page.evaluate(() =>
      localStorage.setItem('freecol.prefs', JSON.stringify({ tilesets: { isometric: 'freecol-plus' } })),
    );
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
