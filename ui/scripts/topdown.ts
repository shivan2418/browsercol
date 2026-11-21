// The Top-down Map view (#530) in the built site, switched on in the debug side panel without a reload. Three games per
// browser, and shots of each in .cache/topdown-<browser>-<what>.png (which the suite uploads with the other shots):
//  - a new game on a random map (?skipstart): the start, in Top-down, and the hit test, which the pointer over a
//    tile's middle must find the tile it is over with;
//  - a revealed big map (preset pan-large): switching keeps the camera on the same tile, both ways, and the map shows
//    its terrain in squares;
//  - a preset with colonies of the player's own (colony-step): a colony's panel in Top-down, whose tiles are a 3x3
//    block of 64 px squares.
// Then the map shapes (#559), a new game of each shape in its own view, zoomed out to show the whole map, with shots in
// .cache/shape-<browser>-<shape>.png: an Isometric shaped game in the Isometric view and a Top-down shaped one in the
// Top-down view (?view=topdown), each revealed (presets shape-isometric and shape-topdown), a rectangle on the screen
// with the arctic along its top and bottom. A game with no preset has the shape of the view the page is in.
// The page must raise no errors. Playing a whole game in the view is play.ts --view topdown.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/topdown.ts [--browsers chromium,firefox]
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { isometric, setMapShape, topDown, projection, setView } from '../src/projection.ts';
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
  // A pixel past the tile's own half a tile (64 px at zoom 1, whatever the zoom) is its neighbour. West,
  // unless the tile is in the first column: a ship can start in the last column, with nothing east of it.
  const dx = tile[0] > 0 ? -1 : 1;
  const zoom = await page.evaluate(() => window.fcView!().zoom as number);
  await page.mouse.move(box.x + px + dx * 48 * zoom, box.y + py);
  await sleep(300);
  const next = await page.evaluate(() => window.fcView!().hover as Tile | null);
  if (!same(next, [tile[0] + dx, tile[1]]))
    throw new Error(`${what}: a tile to the ${dx < 0 ? 'west' : 'east'} of ${label(tile)} hovers ${label(next)}`);
}

/** Zoom out to the farthest level, which shows the whole map if the window is big enough. */
async function zoomOut(page: Page) {
  const canvas = (await page.locator('#map canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 100);
  await sleep(2000);
}

/** What the page's map says of its shape, and its tiles by staggered column and row, as the Engine sends them. */
const shapeOf = (page: Page) =>
  page.evaluate(() => {
    const m = window.__map;
    return { shape: m.shape ?? 'topDown', rows: m.rows ?? 0, w: m.w, h: m.h, types: m.types, tiles: m.tiles };
  });

/**
 * A new game of a shape, in the view it is made for: a shot of the whole map, and a check that the view shows the map
 * as the shape says (a rectangle), and that no tile is on it where the shape has none.
 */
async function shapeGame(name: string, open: () => Promise<Page>, url: string, shape: 'isometric' | 'topDown') {
  const kind = shape === 'isometric' ? 'isometric' : 'topdown';
  setStep(`${name}: a new ${shape}-shaped game in the ${kind} view`);
  const page = await open();
  await page.setViewportSize({ width: 2000, height: 1400 });
  await start(page, url);
  const got = await shapeOf(page);
  if (got.shape !== shape) throw new Error(`the new game's map is ${got.shape}-shaped, not ${shape}`);
  const view = await page.evaluate(() => (document.querySelector('#map-view') as HTMLSelectElement | null)?.value);
  if (view && view !== kind) throw new Error(`the game is in the ${view} view, not ${kind}`);
  // The shape as the UI's own maths has it: the box's tiles that are on the map are the ones the Engine sent.
  setMapShape({ kind: got.shape as 'isometric' | 'topDown', rows: got.rows });
  setView(kind);
  try {
    let onMap = 0;
    for (let y = 0; y < got.h; y++) {
      for (let x = 0; x < got.w; x++) {
        const present = got.tiles[y * got.w + x] !== '.';
        if (present) onMap++;
        const expected = projection.tileAt(got.w, got.h, ...projection.centre(x, y, got.h)) !== null;
        // A tile that is on the map is where the view puts it; one that is not on it has nothing there. The map is
        // revealed only where it is explored, so an unexplored tile of the shape reads '.' too.
        if (present && !expected) throw new Error(`a tile at ${x},${y} is not on a ${shape}-shaped map`);
      }
    }
    if (onMap === 0) throw new Error('no tile is explored');
    // The map is revealed, so every tile of the shape is there: 41 x 102 on an Isometric shape, 58 x 72 on the other.
    const want = shape === 'isometric' ? 41 * 102 : 58 * 72;
    if (onMap !== want) throw new Error(`the ${shape}-shaped map has ${onMap} tiles on the map, not ${want}`);
    // The first and last rows of the screen are all land and polar.
    const typeAt = (x: number, y: number) => got.types[got.tiles.charCodeAt(y * got.w + x) - 65];
    const rows = shape === 'isometric' ? got.rows : got.h;
    for (const row of [0, rows - 1]) {
      const edge: Tile[] = [];
      for (let y = 0; y < got.h; y++) {
        for (let x = 0; x < got.w; x++) {
          const at = shape === 'isometric' ? x + y - (got.w - (got.rows >> 1) - 1) : y;
          if (at === row && typeAt(x, y)) edge.push([x, y]);
        }
      }
      if (edge.length < 20) throw new Error(`row ${row} of the ${shape}-shaped map has only ${edge.length} tiles`);
      if (!edge.every(([x, y]) => typeAt(x, y)!.land))
        throw new Error(`row ${row} of the ${shape}-shaped map is not all land (polar)`);
    }
    const [mw, mh] = projection.mapSize(got.w, got.h);
    await zoomOut(page);
    const { centre, zoom } = await page.evaluate(() => {
      const v = window.fcView!();
      return { centre: v.centre as [number, number], zoom: v.zoom as number };
    });
    // Zoomed all the way out in a big window, the map is smaller than the view and sits in its middle.
    if (Math.abs(centre[0] - mw / 2) > 2 || Math.abs(centre[1] - mh / 2) > 2)
      throw new Error(
        `zoomed out at ${zoom}, the camera is at ${centre.map(Math.round).join(',')} and not at the middle of the ${Math.round(mw)}x${Math.round(mh)} map`,
      );
    if (shape === 'isometric') {
      // A rectangle: the camera cannot be moved off it into the corners of the box's diamond.
      const [kx, ky] = projection.keepOn(got.w, got.h, [0, 0]);
      if (kx !== 0 || ky !== 0) throw new Error(`the top left of an Isometric shaped map is not on its rectangle`);
    }
    await page.mouse.move(0, 0);
    const file = path.join(out, `shape-${name}-${shape === 'isometric' ? 'isometric' : 'topdown'}.png`);
    fs.writeFileSync(file, await page.screenshot());
    console.log(`  ${path.relative(process.cwd(), file)}`);
  } finally {
    setMapShape(null);
    setView('isometric');
  }
  await page.close();
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
    // A new game of each shape, in the view it is made for.
    await shapeGame(name, open, `${server.url}?skipstart&preset=shape-isometric`, 'isometric');
    await shapeGame(name, open, `${server.url}?skipstart&preset=shape-topdown&view=topdown`, 'topDown');

    // A random map.
    setStep(`${name}: a new game on a random map`);
    let page = await open();
    await start(page, `${server.url}?skipstart`);
    // A new game's map has the shape of the view the page opened in.
    const shape = await page.evaluate(() => window.__map.shape);
    if (shape !== 'isometric') throw new Error(`a new game in the Isometric view has a ${shape}-shaped map`);
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
