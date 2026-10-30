// Plays the human's first turns in the built site, through the page's own
// input: arrow and numpad keys, map clicks, B and Enter. The ship sails
// west until land is next to it, moves onto the land to put its units
// ashore, a unit founds a colony and the turn ends; the colony must still
// be there when the AI hands play back. Native dialogs are accepted, a
// choice takes its last item ("All" when disembarking) and an input keeps
// its suggestion. Exits non-zero unless every browser gets there. Run in
// the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/play.mjs [--browsers chromium,firefox]
import path from 'node:path';
import { createRequire } from 'node:module';
import { dist, serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const browsers = opt('browsers', 'chromium,firefox').split(',');
const MAX_TURNS = 15;

// FreeCol's Direction deltas on its staggered rows: [odd row, even row].
const DIRECTIONS = {
  N: [
    [0, -2],
    [0, -2],
  ],
  NE: [
    [1, -1],
    [0, -1],
  ],
  E: [
    [1, 0],
    [1, 0],
  ],
  SE: [
    [1, 1],
    [0, 1],
  ],
  S: [
    [0, 2],
    [0, 2],
  ],
  SW: [
    [0, 1],
    [-1, 1],
  ],
  W: [
    [-1, 0],
    [-1, 0],
  ],
  NW: [
    [0, -1],
    [-1, -1],
  ],
};
// The page's keys for each direction (ui/src/input.ts).
const KEYS = {
  N: 'ArrowUp',
  NE: 'Numpad9',
  E: 'ArrowRight',
  SE: 'Numpad3',
  S: 'ArrowDown',
  SW: 'Numpad1',
  W: 'ArrowLeft',
  NW: 'Numpad7',
};
const WATER = /ocean|highSeas|lake/i;

const neighbour = ([x, y], d) => {
  const [dx, dy] = DIRECTIONS[d][y % 2 ? 0 : 1];
  return [x + dx, y + dy];
};
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const label = (tile) => (tile ? tile.join(',') : 'none');
const at = (list, tile) => list.some(({ x, y }) => same([x, y], tile));

/** The tile type id at a tile of a map view, null if unexplored or off the map. */
function typeAt(m, [x, y]) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const i = m.tiles.charCodeAt(y * m.w + x) - 65;
  return i >= 0 ? m.types[i].id : null;
}

async function play(page, url) {
  // Keep every map view the client Engine sends (ui/src/channel.ts calls
  // fcClientEvent for each), and count them.
  await page.addInitScript(() => {
    let inner;
    window.__maps = 0;
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f) => {
        inner = (name, detail) => {
          if (name === 'map' || name === 'gameStarted') {
            window.__map = JSON.parse(detail);
            window.__maps++;
          }
          return f(name, detail);
        };
      },
    });
  });
  const log = [];
  page.on('dialog', (d) => {
    const choices = d.message().match(/^\d+: /gm);
    log.push(`${d.type()}: ${d.message().split('\n')[0]}`);
    if (d.type() === 'prompt') void d.accept(choices ? String(choices.length - 1) : d.defaultValue());
    else void d.accept();
  });

  const view = () => page.evaluate(() => window.__map);
  /** Do something that ends with a new map view, and return that view. */
  const act = async (doIt) => {
    const n = await page.evaluate(() => window.__maps);
    await doIt();
    await page.waitForFunction((n) => window.__maps > n, n, { timeout: 60000 });
    return view();
  };
  const endTurn = async () => {
    const turn = (await view()).turn;
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 120000 });
    return view();
  };
  const click = async (m, [x, y]) => {
    const box = await page.locator('#map canvas').boundingBox();
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py);
  };

  await page.goto(url);
  await page.waitForFunction(() => window.fcResult, null, { timeout: 120000 });
  let m = await view();
  if (!m.ourTurn) throw new Error('not our turn at the start');

  // Sail west until land is beside the ship, then move onto it to land.
  let land = null;
  for (let turns = 0; !land;) {
    if (!m.active) {
      if (++turns > MAX_TURNS) throw new Error('no land within ' + MAX_TURNS + ' turns');
      m = await endTurn();
      continue;
    }
    const ship = m.active;
    const shore = Object.keys(DIRECTIONS).find((d) => {
      const t = neighbour(ship, d);
      const type = typeAt(m, t);
      return type && !WATER.test(type) && !at(m.settlements, t) && !at(m.units, t);
    });
    m = await act(() => page.keyboard.press(KEYS[shore ?? 'W']));
    if (shore && at(m.units, neighbour(ship, shore))) land = neighbour(ship, shore);
    else if (same(m.active, ship)) {
      // The ship could not move: out of moves or blocked.
      if (++turns > MAX_TURNS) throw new Error('no land within ' + MAX_TURNS + ' turns');
      m = await endTurn();
    }
  }

  // The landed units have no moves left: next turn, select one and build.
  m = await endTurn();
  m = await act(() => click(m, land));
  if (!same(m.active, land)) throw new Error(`clicking ${label(land)} selected ${label(m.active)}`);
  m = await act(() => page.keyboard.press('b'));
  if (!at(m.settlements, land)) throw new Error(`no colony at ${label(land)}; dialogs: ${log.join(' | ')}`);
  m = await endTurn();
  if (!at(m.settlements, land)) throw new Error(`the colony at ${label(land)} is gone after the AI turn`);
  return { land, turn: m.turn, dialogs: log };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t = Date.now();
  let result;
  try {
    result = await play(page, server.url);
    await page.evaluate(([x, y]) => window.fcReveal(x, y), result.land);
    await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  } catch (ex) {
    result = { error: String(ex) };
  }
  await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  await browser.close();
  failed ||= Boolean(result.error) || errors.length > 0;
  console.log(
    `${name} ${browser.version()}: ` +
      (result.error ? `failed: ${result.error}` : `colony at ${label(result.land)}, play back on turn ${result.turn}`) +
      `, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      (result.dialogs ? `\n  dialogs: ${result.dialogs.join(' | ')}` : '') +
      (errors.length ? `\n  page errors: ${errors.join('; ')}` : ''),
  );
}
server.close();
process.exit(failed ? 1 : 0);
