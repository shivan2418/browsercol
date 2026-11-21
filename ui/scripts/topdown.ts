// The Top-down Map view (#530) in the built site, switched on in the debug side panel without a reload. Three games per
// browser, and shots of each in .cache/topdown-<browser>-<what>.png (which the suite uploads with the other shots):
//  - a new game on a random map (?skipstart): the start, in Top-down, and the hit test, which the pointer over a
//    tile's middle must find the tile it is over with;
//  - a revealed big map (preset pan-large): switching keeps the camera on the same tile, both ways, and the map shows
//    its terrain in squares;
//  - a preset with colonies of the player's own (colony-step): a colony's panel in Top-down, whose tiles are a 3x3
//    block of 64 px squares.
// The page must raise no errors. Playing a whole game in the view is play.ts --view topdown.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/topdown.ts [--browsers chromium,firefox]
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { isometric, topDown } from '../src/projection.ts';
import { browserNames, collectPageErrors, diagnose, launchBrowser, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';

const out = path.join(dist, '../.cache');
fs.mkdirSync(out, { recursive: true });
const server = await serveDist();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
type Tile = [number, number];

/** Still terrain: the Isometric view's water is not what is being looked at. */
const still = () =>
  localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.useTerrainAnimations': false } }));

/** The latest map the Engine sent, as scenarios.ts keeps it. */
const keepMap = () => {
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
};

const centre = (page: Page) => page.evaluate(() => window.fcView!().centre as [number, number]);
const mapSize = (page: Page) => page.evaluate(() => [window.__map.w, window.__map.h] as Tile);
const label = (t: Tile | null) => (t ? t.join(',') : 'none');
const same = (a: Tile | null, b: Tile | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Pick the Map view in the side panel's switch, as the player does, and wait for the page to show it. */
async function pick(page: Page, kind: 'isometric' | 'topdown') {
  await page.selectOption('#map-view', kind);
  await page.waitForFunction((k) => (document.querySelector('#map-view') as HTMLSelectElement).value === k, kind);
  // The map is drawn again, and the camera shown.
  await sleep(1500);
}

/** A game of a preset (or a random map without one), up and on the player's turn. */
async function start(page: Page, url: string) {
  await page.goto(url);
  const r = await waitForResult(page, 900000);
  if (r.status !== 'finished') throw new Error(`the page did not start a game: ${JSON.stringify(r)}`);
  await page.waitForFunction(() => window.__map?.ourTurn, null, { timeout: 300000, polling: 500 });
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 30000 });
  await sleep(1500);
}

const shot = async (page: Page, browser: string, what: string) => {
  await page.mouse.move(0, 0);
  const file = path.join(out, `topdown-${browser}-${what}.png`);
  fs.writeFileSync(file, await page.screenshot());
  console.log(`  ${path.relative(process.cwd(), file)}`);
};

/** The pointer at a tile's middle must hover that tile: the hit test, with the camera where it is. */
async function hits(page: Page, tile: Tile, what: string) {
  const box = (await page.locator('#map canvas').boundingBox())!;
  const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), tile);
  await page.mouse.move(box.x + px, box.y + py);
  await sleep(300);
  const hover = await page.evaluate(() => window.fcView!().hover as Tile | null);
  if (!same(hover, tile)) throw new Error(`${what}: the pointer over ${label(tile)} hovers ${label(hover)}`);
  // A pixel past the tile's own half a tile (64 px at zoom 1, whatever the zoom) east is its neighbour.
  const zoom = await page.evaluate(() => window.fcView!().zoom as number);
  await page.mouse.move(box.x + px + 48 * zoom, box.y + py);
  await sleep(300);
  const next = await page.evaluate(() => window.fcView!().hover as Tile | null);
  if (!same(next, [tile[0] + 1, tile[1]]))
    throw new Error(`${what}: a tile to the east of ${label(tile)} hovers ${label(next)}`);
}

let failed = false;
for (const name of browserNames()) {
  const browser = await launchBrowser(name);
  const errors: string[] = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await answerDialogs(page);
    await page.addInitScript(still);
    await page.addInitScript(keepMap);
    errors.push(...collectPageErrors(page));
    return page;
  };
  try {
    // A random map.
    setStep(`${name}: a new game on a random map`);
    let page = await open();
    await start(page, `${server.url}?skipstart`);
    await shot(page, name, 'iso-start');
    await pick(page, 'topdown');
    await shot(page, name, 'start');
    const ours = await page.evaluate(() => window.__map.active);
    if (ours) await hits(page, ours, 'the start');
    await pick(page, 'isometric');
    await shot(page, name, 'start-back');
    await page.close();

    // A revealed big map: the camera stays on its tile, and the terrain is shown.
    setStep(`${name}: a big revealed map`);
    page = await open();
    await start(page, `${server.url}?skipstart&preset=pan-large`);
    const [w, h] = await mapSize(page);
    for (const spot of [
      [100, 60],
      [60, 40],
    ] as Tile[]) {
      await page.evaluate(([x, y]) => window.fcReveal!(x, y), spot);
      await sleep(1000);
      const before = isometric.tileAt(w, h, ...(await centre(page)));
      await pick(page, 'topdown');
      const top = topDown.tileAt(w, h, ...(await centre(page)));
      if (!same(before, top))
        throw new Error(`the camera moved from tile ${label(before)} to ${label(top)} in Top-down`);
      await shot(page, name, `terrain-${spot.join('_')}`);
      await hits(page, spot, `the map at ${label(spot)}`);
      await pick(page, 'isometric');
      const back = isometric.tileAt(w, h, ...(await centre(page)));
      if (!same(before, back))
        throw new Error(`the camera moved from tile ${label(before)} to ${label(back)} on the way back`);
    }
    // Zoomed out: the map in a rectangle on the screen, with its minimap.
    await pick(page, 'topdown');
    const canvas = (await page.locator('#map canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100);
    await sleep(1500);
    await shot(page, name, 'zoomed-out');
    await page.close();

    // A colony's panel.
    setStep(`${name}: a colony's panel in Top-down`);
    page = await open();
    await page.addInitScript(() => (window.__hold = 'colony'));
    await start(page, `${server.url}?skipstart&debug&preset=colony-step`);
    await page.waitForFunction(() => window.__map.settlements.filter((s) => s.population >= 0).length >= 3, null, {
      timeout: 300000,
      polling: 500,
    });
    await pick(page, 'topdown');
    const mine = await page.evaluate(() => window.__map.settlements.find((s) => s.population >= 0)!);
    await shot(page, name, 'colonies');
    await hits(page, [mine.x, mine.y], 'the colony');
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [mine.x, mine.y]);
    await page.mouse.click(box.x + px, box.y + py);
    const win = page.locator('[role=dialog][data-kind=colony]');
    await win.waitFor({ timeout: 30000 });
    await sleep(2000);
    const tiles = await win
      .locator('[data-part=tiles]')
      .evaluate((e) => ({ view: e.getAttribute('data-view'), w: (e as HTMLElement).style.width }));
    if (tiles.view !== 'topdown' || tiles.w !== '192px')
      throw new Error(`the colony's tiles are not a 3x3 block of squares: ${JSON.stringify(tiles)}`);
    const places = await win.locator('.tile').count();
    if (places !== 9) throw new Error(`the colony panel has ${places} tiles, not 9`);
    await page.mouse.move(1360, 760);
    await shot(page, name, 'colony');
    // Switching with the panel open draws its tiles in the other view, and back.
    await pick(page, 'isometric');
    const iso = await win.locator('[data-part=tiles]').evaluate((e) => (e as HTMLElement).style.width);
    if (iso !== '384px') throw new Error(`the colony's tiles are ${iso} wide in the Isometric view, not 384px`);
    await pick(page, 'topdown');
    await sleep(500);
    await page.close();
    console.log(`${name}: ok`);
  } catch (ex) {
    failed = true;
    console.error(`${name}: ${await diagnose(ex)}`);
  }
  if (errors.length) {
    failed = true;
    console.error(`${name}: page errors: ${errors.join(' | ')}`);
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
