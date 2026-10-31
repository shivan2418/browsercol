// Plays the human's first turns in the built site, through the page's own
// input: arrow and numpad keys, map clicks, B, F, H and Enter. The ship sails
// by the shortest explored sea route to free land that can feed a colony,
// or toward the westmost explored sea while none is in sight, moves onto
// the land to put its units ashore, a unit founds a colony, the ship
// fortifies and the turn ends; the colony must still be there when the AI
// hands play back. The Go To order then asks where the ship sails, which
// the page must ask the player. The page's dialogs are answered as
// scripts/dialogs.mjs says, and every question the controllers ask must
// reach one: a dialog with no Browser UI yet fails the run. Along the way
// the map's view must follow the active unit, its cursor and the info panel
// must match the client's active unit, the side panel's buttons must follow
// the Engine's orders, the map canvas must follow a window resize and fill
// what the side panel leaves of the window, and the wheel, a drag and the
// pointer at an edge must zoom and scroll it at its new size. Exits non-zero
// unless every browser gets there. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/play.mjs [--browsers chromium,firefox] [--query renderer=canvas2d|preset=dutch-small] [--scale 2]
import path from 'node:path';
import { browserNames, collectPageErrors, opt, playwright, waitForResult } from './common.mjs';
import { answerDialogs, dialogLog } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const browsers = browserNames();
/** Page parameters, e.g. renderer=canvas2d to play on the Canvas 2D fallback. */
const query = opt('query', '');
/** The device pixel ratio the browser reports: 2 to play as on a HiDPI screen. */
const scale = Number(opt('scale', '1'));
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
// Land whose colony centre yields less food than a colonist eats (classic
// rules), where a lone founder starves on the next turn, or that cannot be
// settled at all.
const BARREN = /arctic|desert|scrubForest|mountains/;
// FreeCol's grey for a fortified unit (MapJson draws it in that colour).
const FORTIFIED = 0x808080;

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

/**
 * Land to found on: explored, not water or barren, nobody's (so founding
 * needs no land claim), and with no settlement or unit on it.
 */
const isFreeLand = (m, t) => {
  const type = typeAt(m, t);
  return (
    type &&
    !WATER.test(type) &&
    !BARREN.test(type) &&
    m.owners[t[1] * m.w + t[0]] === '.' &&
    !at(m.settlements, t) &&
    !at(m.units, t)
  );
};

/**
 * The ship's next step: the direction of free land beside it, or the first
 * step of the shortest route over explored, empty sea to a tile beside free
 * land, or failing that to the westmost explored sea, where more of the
 * map comes into sight. Null if the ship can go nowhere.
 */
function nextStep(m, ship) {
  const dirs = Object.keys(DIRECTIONS);
  const shore = dirs.find((d) => isFreeLand(m, neighbour(ship, d)));
  if (shore) return { dir: shore, shore: neighbour(ship, shore) };
  const first = new Map([[label(ship), null]]);
  const queue = [ship];
  let west = null;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (i > 0 && dirs.some((d) => isFreeLand(m, neighbour(t, d)))) return { dir: first.get(label(t)) };
    if (i > 0 && (!west || t[0] < west[0])) west = t;
    for (const d of dirs) {
      const n = neighbour(t, d);
      if (first.has(label(n)) || !WATER.test(typeAt(m, n) ?? '') || at(m.units, n) || at(m.settlements, n)) continue;
      first.set(label(n), first.get(label(t)) ?? d);
      queue.push(n);
    }
  }
  return west && { dir: first.get(label(west)) };
}

/** How long each screenshot of a dialog took, for the report. */
const shotTimes = [];

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
  // A dialog with images is shot once its images have loaded: the first three of each kind.
  const browserName = page.context().browser().browserType().name();
  // The dialog stays open while it is shot, which Firefox can take long over (on CI, longer than the 10 s
  // noDialog waits for a dialog to close), so noDialog waits for the shot to be done first.
  let shooting = 0;
  shotTimes.length = 0;
  await answerDialogs(page, async (kind, n) => {
    const t = Date.now();
    shooting++;
    try {
      await page.screenshot({ path: path.join(dist, `../.cache/play-${browserName}-${kind}-${n}.png`) });
      shotTimes.push(`${kind} ${n}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
    } catch (ex) {
      shotTimes.push(`${kind} ${n}: failed ${String(ex).split('\n')[0]}`);
    } finally {
      shooting--;
    }
  });

  const view = () => page.evaluate(() => window.__map);
  /**
   * Wait until no dialog is open, since an open one takes the keys and clicks. The 10 s count only the
   * time no shot is being taken.
   */
  const noDialog = async (what = 'a step') => {
    const open = () => page.evaluate(() => document.querySelector('[role=dialog]')?.dataset.kind ?? null);
    let idle = Date.now();
    for (let kind = await open(); kind; kind = await open()) {
      if (shooting > 0) idle = Date.now();
      if (Date.now() - idle > 10000) {
        const detail = await page.evaluate(
          () =>
            `${document.querySelector('[role=dialog]')?.textContent.slice(0, 80)}; answered: ${window.__dialogs.slice(-3).join(' | ')}`,
        );
        throw new Error(
          `a ${kind} dialog stayed open for 10 s before ${what}: ${detail}; screenshots ${shooting > 0 ? 'still being taken' : 'done'}: ${shotTimes.join(' | ')}`,
        );
      }
      await new Promise((ok) => setTimeout(ok, 50));
    }
  };
  /** Do something that ends with a new map view, and return that view. */
  const act = async (doIt) => {
    await noDialog('a command');
    const n = await page.evaluate(() => window.__maps);
    await doIt();
    await page.waitForFunction((n) => window.__maps > n, n, { timeout: 60000 });
    return view();
  };
  const endTurn = async () => {
    const turn = (await view()).turn;
    await noDialog('ending the turn');
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 120000 });
    return view();
  };
  const viewState = () => page.evaluate(() => window.fcView());
  /** The view is on the client's active unit: the cursor on its tile, in view, and the panel naming it. */
  const following = async (m, what) => {
    const v = await viewState();
    if (!m.activeUnit || v.active?.unit !== m.activeUnit.id || !same(v.cursor?.at, m.active)) {
      throw new Error(
        `${what}: the view's active unit ${JSON.stringify(v.active)} is not the client's ${m.activeUnit?.id} at ${label(m.active)}`,
      );
    }
    // The view's own geometry (tileOnScreen in ui/src/view.ts, unit-tested
    // there) places the cursor; clicks through fcReveal rely on the same maths.
    const [px, py] = v.cursorOnScreen;
    if (px < 0 || py < 0 || px > v.viewport[0] || py > v.viewport[1]) {
      throw new Error(`${what}: the active unit at ${label(m.active)} is out of view`);
    }
    // React renders the panel a moment after the view changes.
    const shows = (label) => document.querySelector('#info')?.textContent.startsWith(label);
    if (!(await page.waitForFunction(shows, m.activeUnit.label, { timeout: 5000 }).catch(() => false))) {
      const info = await page.locator('#info').textContent();
      throw new Error(`${what}: the panel shows ${JSON.stringify(info)}`);
    }
  };
  /** The map canvas must fill the window up to the side panel, which must reach the window's right edge. */
  const laidOut = async (what) => {
    // These run in the page, so neither can call the other.
    const boxes = () => {
      const c = document.querySelector('#map canvas').getBoundingClientRect();
      const s = document.querySelector('#side').getBoundingClientRect();
      return { canvas: [c.left, c.right, c.height], side: [s.left, s.right], window: [innerWidth, innerHeight] };
    };
    const fills = () => {
      const c = document.querySelector('#map canvas').getBoundingClientRect();
      const s = document.querySelector('#side').getBoundingClientRect();
      return c.left === 0 && c.right <= s.left && s.right === innerWidth && c.height === innerHeight;
    };
    if (!(await page.waitForFunction(fills, null, { timeout: 5000 }).catch(() => false))) {
      const got = await page.evaluate(boxes);
      throw new Error(`${what}: the map and the side panel do not fill the window: ${JSON.stringify(got)}`);
    }
  };
  /** Widen the side panel: the map must make room for it, and fill the window again once it narrows. */
  const widenSide = async () => {
    const style = await page.addStyleTag({ content: '#side { width: 600px; }' });
    await laidOut('with a wider side panel');
    await style.evaluate((s) => s.remove());
    await laidOut('with the side panel back');
  };
  /** Shrink the window: the map canvas and the view's viewport must shrink with it. */
  const resize = async () => {
    await laidOut('before a resize');
    const before = (await viewState()).viewport;
    const [dw, dh] = [300, 200];
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width - dw, height: size.height - dh });
    const want = [before[0] - dw, before[1] - dh];
    // These run in the page, so neither can call the other.
    const canvasSize = () => {
      const c = document.querySelector('#map canvas');
      return [c?.width, c?.height];
    };
    // The canvas's CSS box is the viewport's size, in CSS pixels, and its
    // backing store is that many device pixels: the map is drawn at the
    // screen's pixel ratio.
    const fits = ([w, h]) => {
      const c = document.querySelector('#map canvas');
      const [vw, vh] = window.fcView().viewport;
      const r = window.devicePixelRatio || 1;
      const box = c?.getBoundingClientRect();
      return (
        box?.width === w &&
        box.height === h &&
        c.width === Math.round(w * r) &&
        c.height === Math.round(h * r) &&
        vw === w &&
        vh === h
      );
    };
    if (!(await page.waitForFunction(fits, want, { timeout: 5000 }).catch(() => false))) {
      const got = await page.evaluate(canvasSize);
      const view = (await viewState()).viewport;
      throw new Error(
        `after a resize the canvas is ${JSON.stringify(got)}, the view ${JSON.stringify(view)}, not ${JSON.stringify(want)}`,
      );
    }
    await laidOut('after a resize');
  };
  /** Zoom with the wheel, drag the map and rest the pointer at its right edge; each must move the view. */
  const zoomAndScroll = async () => {
    await noDialog('zooming');
    const box = await page.locator('#map canvas').boundingBox();
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const before = await viewState();
    await page.mouse.move(cx, cy);
    // mouse.wheel does not wait for the page to handle the event (Firefox
    // may be late), so wait for the zoom to change.
    await page.mouse.wheel(0, -100);
    await page.waitForFunction((z) => window.fcView().zoom > z, before.zoom, { timeout: 5000 }).catch(() => {});
    const zoomed = await viewState();
    if (zoomed.zoom <= before.zoom) throw new Error(`the wheel did not zoom in: ${before.zoom} -> ${zoomed.zoom}`);
    // Drag the map right, so it has room to scroll back at the right edge.
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 100, { steps: 5 });
    await page.mouse.up();
    const dragged = await viewState();
    if (same(dragged.centre, zoomed.centre)) throw new Error('a drag did not scroll the map');
    // The right edge, which only the current viewport's width finds after a resize.
    await page.mouse.move(box.x + box.width - 4, cy);
    await page.waitForTimeout(800);
    await page.mouse.move(cx, cy);
    if (same((await viewState()).centre, dragged.centre)) {
      throw new Error('resting the pointer at the right edge did not scroll the map');
    }
    await page.mouse.wheel(0, 100);
  };
  const click = async (m, [x, y]) => {
    const box = await page.locator('#map canvas').boundingBox();
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py);
  };

  await page.goto(url);
  await waitForResult(page, 120000);
  let m = await view();
  if (!m.ourTurn) throw new Error('not our turn at the start');
  await following(m, 'at the start');
  await resize();
  await widenSide();
  await zoomAndScroll();

  // Sail toward land until it is beside the ship, then move onto it to land.
  let land = null;
  for (let turns = 0; !land;) {
    const step = m.active && nextStep(m, m.active);
    if (!step) {
      if (++turns > MAX_TURNS) throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(m.active)}`);
      m = await endTurn();
      continue;
    }
    const ship = m.active;
    m = await act(() => page.keyboard.press(KEYS[step.dir]));
    if (m.activeUnit) await following(m, 'after a move');
    if (step.shore && at(m.units, step.shore)) land = step.shore;
    else if (same(m.active, ship)) {
      // The ship could not move: out of moves or blocked.
      if (++turns > MAX_TURNS) throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(ship)}`);
      m = await endTurn();
    }
  }

  // The ship is the active unit while it sails: remember where it is, to
  // select it and fortify it later.
  const shipTile = m.active;

  // The landed units have no moves left: next turn, select one and build.
  m = await endTurn();
  m = await act(() => click(m, land));
  if (!same(m.active, land)) throw new Error(`clicking ${label(land)} selected ${label(m.active)}`);
  await following(m, 'after selecting a unit');
  m = await act(() => page.keyboard.press('b'));
  if (!at(m.settlements, land)) throw new Error(`no colony at ${label(land)}`);
  m = await endTurn();
  if (!at(m.settlements, land)) throw new Error(`the colony at ${label(land)} is gone after the AI turn`);

  // The ship is still at sea: select it and fortify it, as a player would.
  // The side panel's Fortify button follows the Engine's orders, and the
  // ship is drawn in grey once its turn has ended.
  m = await act(() => click(m, shipTile));
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship');
  const fortify = page.locator('button[data-command=fortify]');
  if (await fortify.isDisabled()) throw new Error('the ship cannot be fortified');
  m = await act(() => page.keyboard.press('f'));
  m = await endTurn();
  const ship = m.units.find((u) => u.x === shipTile[0] && u.y === shipTile[1]);
  if (!ship || ship.fg !== FORTIFIED) {
    throw new Error(`the ship at ${label(shipTile)} is not fortified: ${JSON.stringify(ship)}`);
  }

  // The Go To order, as GotoAction binds it: the player must be asked
  // where the ship sails. Where it goes is CommandsTest's to check. The ship
  // is the active unit again, as it was when it was fortified.
  m = await act(() => click(m, shipTile));
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship for the Go To order');
  await act(() => page.keyboard.press('h'));
  const asked = await page
    .waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('choice: Select destination')), null, {
      timeout: 10000,
    })
    .catch(() => false);
  if (!asked) {
    const dialogs = await page.evaluate(() => window.__dialogs);
    throw new Error(`the Go To order did not ask for a destination: ${JSON.stringify(dialogs)}`);
  }

  // The art the dialogs show, from events as the client Engine sends them (the page's fcShow): the
  // event panel's two flavour images, and a turn report with the image of each kind of object, and
  // its group by option and buttons. The real game gives few of these in its first turns.
  const show = async (kind, event) => {
    await noDialog(`showing the ${kind} event`);
    const before = await page.evaluate(() => window.__pictures.length);
    await page.evaluate(([k, json]) => window.fcShow(k, json), [kind, JSON.stringify(event)]);
    await page
      .waitForFunction((n) => window.__pictures.length > n, before, { timeout: 10000 })
      .catch(async () => {
        throw new Error(
          `no dialog with images came for the ${kind} event within 10 s; the page shows ${await page.evaluate(
            () => document.querySelector('[role=dialog]')?.outerHTML.slice(0, 300) ?? 'no dialog',
          )}`,
        );
      });
    await noDialog(`the ${kind} event was answered`);
  };
  const ok = 'OK';
  await show('eventPanel', { header: 'Landfall', image: 'image.flavor.event.firstLanding', footer: null, ok });
  await show('eventPanel', { header: 'The Pacific', image: 'image.flavor.event.discoverPacific', footer: null, ok });
  const message = (text, type, images, more = {}) => ({
    text,
    type,
    source: null,
    tile: null,
    at: null,
    heading: null,
    images,
    filter: null,
    filterTip: null,
    ignored: false,
    ignoreTip: null,
    ...more,
  });
  const warehouse = {
    filter: true,
    filterTip: 'Do not display this type of message',
    ignoreTip: 'Ignore this message',
  };
  await show('messages', {
    title: 'Turn Report',
    ok,
    groupBy: {
      label: 'Group messages by',
      value: 0,
      choices: [
        { value: 0, text: 'Nothing' },
        { value: 1, text: 'Type' },
        { value: 2, text: 'Source' },
      ],
    },
    messages: [
      message('A free colonist is a unit.', 'DEFAULT', ['image.unit.model.unit.freeColonist']),
      message('The Dutch are a nation.', 'DEFAULT', ['image.miscicon.model.nation.dutch']),
      message('Food is goods.', 'WAREHOUSE_CAPACITY', ['image.icon.model.goods.food'], warehouse),
      message('A town hall is a building.', 'DEFAULT', ['image.buildingicon.model.building.townHall']),
      message('Plains are terrain.', 'DEFAULT', ['image.tile.model.tile.plains.center']),
      message('A colony is a settlement.', 'DEFAULT', [
        'image.tileitem.model.settlement.colony.small.dutch',
        'image.tileitem.model.settlement.colony.small',
      ]),
      message('Nothing to show.', 'DEFAULT', []),
    ],
  });
  return { land, turn: m.turn };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: scale });
  const errors = collectPageErrors(page);
  const t = Date.now();
  let result;
  try {
    result = await play(page, server.url + (query ? `?${query}` : ''));
    await page.evaluate(([x, y]) => window.fcReveal(x, y), result.land);
    await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  } catch (ex) {
    result = { error: String(ex) };
  }
  await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  const log = await dialogLog(page).catch(() => ({ dialogs: [], pictures: [], unasked: [] }));
  const { dialogs, pictures } = log;
  // The art of the dialogs must have loaded, and the first landing's event panel must have had its image.
  const broken = pictures.filter((p) => !p.loaded);
  if (!result.error && broken.length > 0) result = { error: `dialog images did not load: ${JSON.stringify(broken)}` };
  if (!result.error && !pictures.some((p) => p.kind === 'eventPanel' && /landing/.test(p.src))) {
    result = { error: `the first landing's event panel showed no image: ${JSON.stringify(pictures)}` };
  }
  // The controllers open the colony panel themselves (after founding), which has no Browser UI yet.
  const unasked = log.unasked.filter((method) => method !== 'showColonyPanel');
  const routine = log.unasked.length - unasked.length;
  await browser.close();
  failed ||= Boolean(result.error) || errors.length > 0 || unasked.length > 0;
  console.log(
    `${name} ${browser.version()}: ` +
      (result.error ? `failed: ${result.error}` : `colony at ${label(result.land)}, play back on turn ${result.turn}`) +
      `, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      `\n  dialogs: ${dialogs.join(' | ')}` +
      (shotTimes.length ? `\n  screenshots: ${shotTimes.join(' | ')}` : '') +
      `\n  images: ${pictures.map((p) => `${p.kind} ${p.src}`).join(' | ')}` +
      (routine ? `\n  colony panel not shown (no Browser UI yet): ${routine}x` : '') +
      (unasked.length ? `\n  no dialog yet for: ${unasked.join(', ')}` : '') +
      (errors.length ? `\n  page errors: ${errors.join('; ')}` : ''),
  );
}
server.close();
process.exit(failed ? 1 : 0);
