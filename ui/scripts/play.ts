// Plays the human's first turns in the built site, through the page's own
// input: arrow and numpad keys, map clicks, B, H and Enter, and the Fortify
// button over the map, which must be on top of the map's canvas and is
// clicked with the mouse (#245). The ship sails by the shortest explored sea
// route to free land that can feed a colony, or toward the westmost explored
// sea while none is in sight, moves onto the land to put its units ashore, a unit founds a colony (whose panel
// opens and must show the founder), the ship fortifies and the turn ends;
// the colony must still be there when the AI hands play back. The Go To
// order then asks where the ship sails, which the page must ask the player.
// The colony panel's two quick drops, a unit and goods aboard the ship in
// one turn, must both land: the Engine runs the commands one at a time, and
// queues the one that comes while another runs.
// The page's dialogs are answered as scripts/dialogs.ts says, and every
// question the controllers ask must reach one: a dialog with no Browser UI yet fails the run. Along the way
// the map's view must follow the active unit, its cursor and the info panel
// must match the client's active unit, the side panel's buttons must follow
// the Engine's orders, the map canvas must follow a window resize and fill
// what the side panel leaves of the window, and the wheel, a drag and the
// pointer at an edge must zoom and scroll it at its new size. Exits non-zero
// unless every browser gets there. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/play.ts [--browsers chromium,firefox] [--query renderer=canvas2d|preset=dutch-small|preset=] (default preset: play) [--scale 2]
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import type { MapView, Unit } from '../src/tileset.ts';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs, dialogLog } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';

const browsers = browserNames();
/**
 * Page parameters, e.g. renderer=canvas2d to play on the Canvas 2D fallback. Unless they name a preset, the
 * game starts from ui/presets/play.json, a seeded map with free land two or three turns from the ship, so that
 * every run lands the same way (#30). `--query preset=` (empty) plays a random map instead.
 */
const given = opt('query', '');
const query = /(^|&)preset=/.test(given)
  ? given.replace(/(^|&)preset=(&|$)/, '$2')
  : `preset=play${given ? `&${given}` : ''}`;
/** The device pixel ratio the browser reports: 2 to play as on a HiDPI screen. */
const scale = Number(opt('scale', '1'));
const MAX_TURNS = 15;

/** A tile's [x, y]. */
type Tile = [number, number];
/** A free land the ship can sail to, how far it is and the first step there (freeLands). */
interface Land {
  tile: Tile;
  dist: number;
  dir: Dir | null | undefined;
}
/** What the Europe panel showed when it was shot (europePanel). */
interface EuropeSeen {
  recruits: number;
  trains: number;
  buys: (string | null)[];
  sailDisabled: boolean;
  headings: (string | null)[];
  lists: (string | undefined)[];
  goods: number;
  prices: (string | null)[];
}
/** What a browser's run came to. */
interface Result {
  error?: string;
  land?: Tile | null;
  turn?: string;
  note?: string;
}

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
type Dir = keyof typeof DIRECTIONS;
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
// The arctic is the only land with no work for a colonist: every other land
// has a production a colonist can make.
const NO_WORK = /arctic/i;
// How much farther the ship may sail for land whose colony has a tile to
// work than for the nearest land, in tiles: only a short detour, as the ship
// has a budget of turns to find land, and the script puts the founder to
// work itself when the colony has a tile to work.
const MAX_DETOUR = 2;
// FreeCol's grey for a fortified unit (MapJson draws it in that colour).
const FORTIFIED = 0x808080;

const neighbour = ([x, y]: Tile, d: Dir): Tile => {
  const [dx, dy] = DIRECTIONS[d][y % 2 ? 0 : 1];
  return [x + dx, y + dy];
};
const same = (a: Tile | null | undefined, b: Tile | null | undefined) => a && b && a[0] === b[0] && a[1] === b[1];
const label = (tile: Tile | null | undefined) => (tile ? tile.join(',') : 'none');
const at = (list: { x: number; y: number }[], tile: Tile) => list.some(({ x, y }) => same([x, y], tile));

/** The tile type id at a tile of a map view, null if unexplored or off the map. */
function typeAt(m: MapView, [x, y]: Tile) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const i = m.tiles.charCodeAt(y * m.w + x) - 65;
  return i >= 0 ? m.types[i].id : null;
}

/**
 * Whether the tile has a lost city rumour, as the map shows it when the tile
 * is seen: a rumour cannot be claimed, so a colony cannot work the tile.
 */
const hasRumour = (m: MapView, t: Tile) =>
  m.items.some(([x, y, , , image]) => x === t[0] && y === t[1] && /lostCityRumour/.test(image));

/**
 * A tile the colony's colonists can work: land that is not the arctic (the
 * only land with no work for a colonist), and nobody's and empty, so that
 * the colony claims it when it is founded, and without a lost city rumour,
 * which cannot be claimed. FreeCol puts the founder to work on the best of
 * the colony's tiles, and in the town hall (which makes bells) when the
 * colony has none.
 */
const isWorkable = (m: MapView, t: Tile) => {
  const type = typeAt(m, t);
  return (
    type &&
    !WATER.test(type) &&
    !NO_WORK.test(type) &&
    m.owners[t[1] * m.w + t[0]] === '.' &&
    !at(m.settlements, t) &&
    !at(m.units, t) &&
    !hasRumour(m, t)
  );
};

/**
 * Whether a colony founded on the tile would have a tile for its colonists
 * to work: FreeCol puts the founder in the town hall when it has none.
 */
const hasWork = (m: MapView, t: Tile) => (Object.keys(DIRECTIONS) as Dir[]).some((d) => isWorkable(m, neighbour(t, d)));

/**
 * Land to found on: explored, not water or barren, nobody's (so founding
 * needs no land claim), and with no settlement or unit on it.
 */
const isFreeLand = (m: MapView, t: Tile) => {
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

/** Land that a nation owns: native land, which the script does not found on. */
function ownedLand(m: MapView, t: Tile) {
  const type = typeAt(m, t);
  return Boolean(type) && !WATER.test(type!) && m.owners[t[1] * m.w + t[0]] !== '.';
}

/**
 * The free lands the ship can sail to, and how far they are: the land
 * beside the ship is one tile away, the land beside the sea tile next to it
 * two, and so on. The search follows the explored, empty sea only, as the
 * ship has seen no more of the map yet, and the direction is the first step
 * of the shortest route to the land.
 */
function freeLands(m: MapView, ship: Tile, visited = new Set<string>()) {
  const dirs = Object.keys(DIRECTIONS) as Dir[];
  const lands = new Map<string, Land>();
  const first = new Map<string, Dir | null>([[label(ship), null]]);
  const dist = new Map([[label(ship), 0]]);
  const queue = [ship];
  let west: Tile | null = null;
  let coast: Tile | null = null;
  let frontier: Tile | null = null;
  const frontiers: { t: Tile; d: number }[] = [];
  const unexplored = ([x, y]: Tile) => x >= 0 && y >= 0 && x < m.w && y < m.h && !typeAt(m, [x, y]);
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const d = dist.get(label(t))!;
    for (const dir of dirs) {
      const n = neighbour(t, dir);
      if (!isFreeLand(m, n)) continue;
      const key = label(n);
      if (!lands.has(key)) {
        lands.set(key, { tile: n, dist: d + 1, dir: d === 0 ? dir : first.get(label(t)) });
      }
    }
    // Sea the ship has not been on yet: it is where more of the map may come into sight, and standing on
    // the same two tiles over and over shows nothing new. The westmost one is nearest the unexplored west;
    // the first found of its column is the nearest to the ship. Sea beside native land is the coast to
    // follow, south as well as west, when no free land is in sight.
    if (i > 0 && !visited.has(label(t))) {
      if (!west || t[0] < west[0]) west = t;
      if (!coast && dirs.some((dir) => ownedLand(m, neighbour(t, dir)))) coast = t;
      // The frontier is sea beside unexplored tiles, where sailing shows more of the map. The westmost
      // frontier tile is the goal, the nearest of them (the search runs nearest first) when several share
      // a column. Plain westmost sea is no goal: at the west edge every tile ties and the ship crawls along
      // it, and nearest-frontier alone crawls along the edge of what the ship has already seen.
      if (dirs.some((dir) => unexplored(neighbour(t, dir)))) {
        frontiers.push({ t, d });
        if (!frontier || t[0] < frontier[0]) frontier = t;
      }
    }
    for (const dir of dirs) {
      const n = neighbour(t, dir);
      if (first.has(label(n)) || !WATER.test(typeAt(m, n) ?? '') || at(m.units, n) || at(m.settlements, n)) continue;
      first.set(label(n), first.get(label(t)) ?? dir);
      dist.set(label(n), d + 1);
      queue.push(n);
    }
  }
  // Once the westmost frontier is at the map's west edge, the west has been seen and every edge tile ties:
  // sail instead to the frontier with the most unexplored map around it, less its distance.
  if (frontier && frontier[0] <= 2) {
    const around = ({ t, d }: { t: Tile; d: number }) => {
      let n = 0;
      for (let y = t[1] - 4; y <= t[1] + 4; y++) for (let x = t[0] - 4; x <= t[0] + 4; x++) if (unexplored([x, y])) n++;
      return n - d / 2;
    };
    frontier = frontiers.reduce((a, b) => (around(b) > around(a) ? b : a)).t;
  }
  const sail = coast ?? frontier ?? west;
  return { lands, west: sail && { tile: sail, dir: first.get(label(sail)) } };
}

/**
 * The land the ship should sail to: the nearest free land, or, when one a
 * colony has a tile to work on lies at most MAX_DETOUR tiles farther, that
 * one, so that FreeCol puts the founder on a tile and not in the town hall.
 * The preference never costs more than the detour. When no land is in sight,
 * the ship sails for the westmost sea it knows, where more of the map comes
 * into sight.
 */
function bestLand(
  m: MapView,
  ship: Tile,
  visited: Set<string>,
): { tile?: Tile; dist: number; dir: Dir | null | undefined } | null {
  const { lands, west } = freeLands(m, ship, visited);
  const all = [...lands.values()];
  if (!all.length) return west && { dir: west.dir, dist: Infinity };
  const nearest = all.reduce((a, b) => (b.dist < a.dist ? b : a));
  const good = all.filter((l) => l.dist <= nearest.dist + MAX_DETOUR && !hasRumour(m, l.tile) && hasWork(m, l.tile));
  return good.length ? good.reduce((a, b) => (b.dist < a.dist ? b : a)) : nearest;
}

/** How long each screenshot of a dialog took, for the report. */
const shotTimes: string[] = [];
/** What the Europe panel showed when it was shot, as it was asked for by the Europe button. */
const europeSeen: (EuropeSeen | null)[] = [];

async function play(page: Page, url: string) {
  // Tutorial messages are off by default; the script turns them on to check the build colony tutorial
  // that follows the first landing.
  await page.addInitScript(() => {
    const p = JSON.parse(localStorage.getItem('freecol.prefs') ?? '{}');
    if (p.tutorial === undefined) localStorage.setItem('freecol.prefs', JSON.stringify({ ...p, tutorial: true }));
  });
  // Keep every map view the client Engine sends (ui/src/channel.ts calls
  // fcClientEvent for each), and count them.
  await page.addInitScript(() => {
    let inner: ((name: string, detail: string) => unknown) | undefined;
    window.__maps = 0;
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f: (name: string, detail: string) => unknown) => {
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
  /** The Europe panel, as the page draws it: its headings, its lists and its goods. */
  const europePanel = () =>
    page.evaluate(async (): Promise<EuropeSeen | null> => {
      const d = document.querySelector('[role=dialog][data-kind=europe]');
      if (!d) return null;
      // The panel's lists are opened by its buttons, and are counted in the dialog the script is shooting:
      // the script closes it once shot.
      const shop = async (kind: string, what: string) => {
        d.querySelector<HTMLButtonElement>(`button[data-europe=${kind}]`)?.click();
        await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 50)));
        return [...d.querySelectorAll(`[data-shop=${kind}] ${what}`)];
      };
      const recruits = (await shop('recruit', '[data-recruit]')).length;
      const trains = (await shop('train', '[data-offer]')).length;
      const buys = (await shop('purchase', '[data-offer] .price')).map((p) => p.textContent);
      d.querySelector<HTMLButtonElement>('button[data-europe=purchase]')?.click();
      await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 50)));
      return (
        d && {
          recruits,
          trains,
          buys,
          sailDisabled: d.querySelector<HTMLButtonElement>('button[data-europe=sail]')?.disabled === true,
          headings: [...d.querySelectorAll('h2, h3')].map((h) => h.textContent),
          lists: [...d.querySelectorAll<HTMLElement>('[data-list]')].map((l) => l.dataset.list),
          goods: d.querySelectorAll('[data-goods]').length,
          prices: [...d.querySelectorAll('.price')].map((p) => p.textContent),
        }
      );
    });
  // A dialog with images is shot once its images have loaded: the first three of each kind.
  const browserName = page.context().browser()!.browserType().name();
  // The dialog stays open while it is shot, which Firefox can take long over (on CI, longer than the 10 s
  // noDialog waits for a dialog to close), so noDialog waits for the shot to be done first.
  let shooting = 0;
  shotTimes.length = 0;
  await answerDialogs(page, async (kind: string | undefined, n: number) => {
    const t = Date.now();
    shooting++;
    try {
      if (kind === 'europe') europeSeen.push(await europePanel());
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
   * Wait until the unit that moved has slid to its tile and the view has caught up with the Engine: the camera moves
   * on to the next unit only once the slide is over, as Swing's does.
   */
  const settled = () => page.evaluate(() => window.fcSettled!());
  /**
   * Wait until no dialog is open, since an open one takes the keys and clicks. The 10 s count only the
   * time no shot is being taken.
   */
  const noDialog = async (what = 'a step') => {
    const open = () => page.evaluate(() => document.querySelector<HTMLElement>('[role=dialog]')?.dataset.kind ?? null);
    let idle = Date.now();
    for (let kind = await open(); kind; kind = await open()) {
      if (shooting > 0) idle = Date.now();
      if (Date.now() - idle > 10000) {
        const detail = await page.evaluate(
          () =>
            `${document.querySelector('[role=dialog]')?.textContent!.slice(0, 80)}; answered: ${window.__dialogs.slice(-3).join(' | ')}`,
        );
        throw new Error(
          `a ${kind} dialog stayed open for 10 s before ${what}: ${detail}; screenshots ${shooting > 0 ? 'still being taken' : 'done'}: ${shotTimes.join(' | ')}`,
        );
      }
      await new Promise((ok) => setTimeout(ok, 50));
    }
  };
  /**
   * Press a map key until the page takes it. The page drops a key while a dialog is queued, and the
   * Engine can queue one (a message after a move) between noDialog's look at the page and the press,
   * before React has drawn it: noDialog sees no dialog, and the key is lost (#111). The page marks a key
   * it runs a command for with preventDefault, so a listener added after the page's own sees whether it
   * did; a dialog on screen stops the key before then (and takes Enter as its answer), and the listener
   * sees nothing.
   */
  const pressKey = async (name: string) => {
    for (let attempt = 1; ; attempt++) {
      await noDialog(`pressing ${name}`);
      await page.evaluate(() => {
        window.__keyTaken = null;
        window.__keyListener = (e) => (window.__keyTaken = e.defaultPrevented);
        addEventListener('keydown', window.__keyListener);
      });
      let taken = false;
      try {
        await page.keyboard.press(name);
        // Playwright's press returns once the page has run its keydown listeners.
        taken = await page.evaluate(() => window.__keyTaken === true);
      } finally {
        await page.evaluate(() => removeEventListener('keydown', window.__keyListener));
      }
      if (taken) return;
      if (attempt === 5) throw new Error(`the page did not take ${name} after ${attempt} presses`);
      console.log(`  the page did not take ${name}; pressed again`);
    }
  };
  /**
   * The order buttons over the map, with an active unit: each is what the page hits at its centre (nothing,
   * such as the map's canvas, covers it), and none overlaps the info panel or the minimap.
   */
  const ordersOnTop = async (what: string) => {
    const check = () => {
      const buttons = [...document.querySelectorAll<HTMLElement>('#map-orders button')];
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const others = ['#info-panel', '#minimap']
        .map((s) => document.querySelector(s))
        .filter((e) => e && e.getClientRects().length > 0)
        .map((e) => ({ id: e!.id, rect: e!.getBoundingClientRect() }));
      const bad = buttons.flatMap((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covered = hit === b ? [] : [`${b.dataset.order} under ${hit ? hit.tagName + '#' + hit.id : 'nothing'}`];
        return [
          ...covered,
          ...others.filter((o) => overlaps(r, o.rect)).map((o) => `${b.dataset.order} over #${o.id}`),
        ];
      });
      return buttons.length === 0 ? ['no order buttons'] : bad;
    };
    // The layout may still be settling after the side panel was shown or hidden: up to 5 s.
    let bad: string[] = [];
    for (let i = 0; i < 50; i++) {
      bad = await page.evaluate(check);
      if (bad.length === 0) return;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`the order buttons are not on top ${what}: ${bad.join(', ')}`);
  };
  /** Do something that ends with a new map view, and return that view. */
  const act = async (doIt: () => Promise<unknown>) => {
    await noDialog('a command');
    const n = await page.evaluate(() => window.__maps);
    await doIt();
    await page.waitForFunction((n) => window.__maps > n, n, { timeout: 60000, label: 'the map after a command' });
    await settled();
    return view();
  };
  /**
   * Click a tile to select the unit on it. The view scrolls when the client picks the unit to play with, and a
   * click aimed before the scroll lands on the tile that was at that pixel; so when another unit is selected,
   * the tile is revealed and clicked again, up to three times.
   */
  const select = async (m: MapView, tile: Tile) => {
    for (let attempt = 1; ; attempt++) {
      const n = await page.evaluate(() => window.__maps);
      await noDialog('a click');
      await click(m, tile);
      await page
        .waitForFunction(
          ([n, [x, y]]: [number, Tile]) =>
            window.__maps > n && window.__map.active?.[0] === x && window.__map.active?.[1] === y,
          [n, tile],
          { timeout: attempt < 3 ? 3000 : 60000, label: 'the clicked tile selects its unit' },
        )
        .catch(() => {});
      m = await view();
      if (same(m.active, tile) || attempt === 3) return m;
    }
  };
  const endTurn = async (expectUnit = false) => {
    const turn = (await view()).turn;
    await pressKey('Enter');
    await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, {
      timeout: 120000,
      label: 'the next turn starts and play is back with the human',
    });
    // The client picks the unit to play with, which the map names when it comes: the map of the new
    // turn may come first, with no unit yet, and the script must not spend its turns on that.
    if (expectUnit) {
      await page
        .waitForFunction(() => window.__map.active, null, {
          timeout: 10000,
          label: 'the client picks a unit for the new turn',
        })
        .catch(() => {});
    }
    return view();
  };
  /**
   * Pick a thing up in the colony panel: the panel is shown afresh as each change reaches the client, so a
   * click can land as it is redrawn; a pick is clicked again until it shows picked.
   */
  const pickUp = async (thing: Locator, what: string) => {
    for (let i = 0; i < 5; i++) {
      await thing.click();
      if ((await thing.getAttribute('data-picked')) === 'true') return;
      await page.waitForTimeout(300);
    }
    throw new Error(`a click did not pick ${what}`);
  };
  /**
   * Wait for a dialog in the log, which grows as the page answers the dialogs: the entries after the
   * count are the ones that came since. Throws with them when the dialog does not come. The dialog is
   * named by the start of its entry, e.g. "amount: ", for a page function cannot be given a function
   * to match with.
   */
  const waitForDialog = async (logged: number, prefix: string, what: string, timeout = 10000) => {
    const got = await page
      .waitForFunction(
        ([n, p]: [number, string]) => (window.__dialogs ?? []).slice(n).some((d) => d.startsWith(p)),
        [logged, prefix],
        {
          timeout,
          label: `the dialog "${prefix}" opens (${what})`,
        },
      )
      .then(() => true)
      .catch((ex) => {
        // Only a timeout means the dialog did not come; anything else is a fault in the page.
        if (ex instanceof Error && /timeout/i.test(ex.message)) return false;
        throw ex;
      });
    if (got) return;
    const seen = await page.evaluate((n) => (window.__dialogs ?? []).slice(n), logged);
    throw new Error(`${what}: ${JSON.stringify(seen)}`);
  };
  /** Where a screen's screenshot goes: .cache/dialog-shots/<Swing method>-<browser>.png, for review (not in git). */
  const shot = (method: string) => {
    const dir = path.join(dist, '../.cache/dialog-shots');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${method}-${browserName}.png`);
  };
  /**
   * Open a window of the page as a player does (open: a menu entry, a key, a click), and look at it before it
   * closes: it must show text with no unset value in it, matching what it should say. The dialog answerer is told
   * to leave its kind open, the window is shot into .cache/play-<browser>-<shot>.png, then closed with the
   * selector close names (a button of the window). Returns the window's text and what check, run while it is
   * open, returned.
   */
  const inspect = async <T = void>(
    what: string,
    kind: string,
    shotName: string,
    open: () => Promise<unknown>,
    says: RegExp,
    close = '[data-answer=close]',
    check?: (d: Locator) => Promise<T>,
  ) => {
    // Over a panel the script holds open (the colony's), a dialog is open by design.
    if (!(await page.evaluate(() => window.__hold))) await noDialog(`opening ${what}`);
    const before = await page.evaluate(() => window.__hold ?? null);
    await page.evaluate(([b, k]) => (window.__hold = `${b},${k}`), [before ?? '', kind]);
    await open();
    // A window of the page's own has no kind, and is found by its id (dialogs.ts names it so too).
    const sel = `[role=dialog][data-kind="${kind}"], [role=dialog]#${kind}`;
    const d = page.locator(sel).last();
    await d.waitFor({ timeout: 15000, label: `${what} opens` });
    // The window may fill after it opens (a report's rows come with its first draw): wait for its text.
    await page
      .waitForFunction(
        ([q, re, fl]: [string, string, string]) => {
          const ds = document.querySelectorAll<HTMLElement>(q);
          return new RegExp(re, fl).test(ds[ds.length - 1]?.innerText ?? '');
        },
        [sel, says.source, says.flags],
        { timeout: 10000, label: `${what} says ${says}` },
      )
      .catch(async () => {
        throw new Error(`${what} does not say ${says}: ${(await d.innerText()).slice(0, 300)}`);
      });
    const text = await d.innerText();
    const broken = kind === 'log' ? null : /undefined|NaN|\[object|\bnull\b/.exec(text);
    if (broken) throw new Error(`${what} shows an unset value (${broken[0]}): ${text.slice(0, 300)}`);
    const found = check ? await check(d) : (undefined as T);
    await page.screenshot({ path: shot(shotName) });
    await d.locator(close).first().click();
    await d.waitFor({ state: 'detached', timeout: 10000, label: `${what} closes` });
    await page.evaluate((k) => (window.__hold = k), before);
    console.log(`  ${what}: ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
    return { text, found };
  };
  /**
   * Open the colony's panel and move colonists in it as a player would: the founder is dragged to a building,
   * clicked back to its tile, given other work, and a colonist outside is put to work and out again, and a building is queued. After each
   * move the panel must show the colonist in its new place, and the net production must have changed.
   */
  const moveColonists = async (m: MapView, land: Tile, founder: string) => {
    await noDialog('opening the colony panel');
    await page.evaluate(() => (window.__hold = 'colony'));
    await act(() => click(m, land));
    const panel = page.locator('[role=dialog][data-kind=colony]');
    await panel.waitFor({ timeout: 10000, label: 'the colony panel opens' });
    // The net production is drawn as icons, one for each of the amount, and text only for a loss or a large
    // amount, so its text alone is empty for a small one: the state is each goods with its icons and text.
    const netOf = () =>
      [...document.querySelectorAll<HTMLElement>('[data-part=net] .made-goods')]
        .map(
          (e) =>
            `${e.dataset.goods}:${e.querySelectorAll('img, .name').length}:${e.querySelector('.amount')?.textContent ?? ''}`,
        )
        .join(' ');
    const net = () => page.evaluate(netOf);
    const unit = (id: string) => panel.locator(`[data-unit="${id}"]`).first();
    const within = (place: Locator, id: string, timeout = 20000) =>
      place.locator(`[data-unit="${id}"]`).waitFor({ timeout, label: 'a unit shows in a place of the colony panel' });
    /** Whether the unit is in the place, as the panel is shown again after a change. */
    const landed = async (place: Locator, id: string, timeout = 20000) =>
      within(place, id, timeout).then(
        () => true,
        () => false,
      );
    /**
     * Drag a colonist onto a place and wait for it to show there. The panel is shown afresh as each change
     * reaches the client, and a drag that a redraw interrupts drops nowhere, as a player's would: the drag
     * is made again, up to three times, and the error names the place when none of them took.
     */
    const dragInto = async (id: string, target: Locator, place: Locator, what: string) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await unit(id).dragTo(target);
        if (await landed(place, id, 10000)) return;
        console.log(`  the colony panel did not take the drag of ${id} ${what}; dragged again`);
      }
      throw new Error(`the drag of ${id} ${what} did not take in 3 tries`);
    };
    const changed = async (than: string, what: string) => {
      await page
        // netOf runs in the page as its source, in a string expression.
        .waitForFunction(`(${netOf.toString()})() !== ${JSON.stringify(than)}`, null, {
          timeout: 20000,
          label: 'the net production changes',
        })
        .catch(() => {
          throw new Error(`the net production did not change after ${what}`);
        });
      return net();
    };
    // Where the founder is in the panel: on a tile, in a building, or outside the colony. FreeCol puts
    // the founder to work on the colony's best tile, and in the town hall when the colony has none.
    const start = await unit(founder).evaluate((e): { tile?: string; place?: string } => {
      const tile = e.closest<HTMLElement>('[data-tile]');
      if (tile) return { tile: tile.dataset.tile };
      const building = e.closest('[data-building]');
      if (building) return { place: `the ${building.getAttribute('aria-label') ?? 'building'}` };
      return {
        place: e.closest<HTMLElement>('[data-part]')?.dataset.part === 'outside' ? 'outside the colony' : 'nowhere',
      };
    });
    let tileId: string | null = start.tile ?? null;
    if (!tileId) {
      // The colony has no tile for the founder to work (its tiles are water,
      // or the arctic, or land nobody may claim), so FreeCol put it in the
      // town hall. The script puts it to work on a tile itself, as a player
      // would: the panel's tiles that are not taken (the centre excepted, it
      // takes no colonist) and not native land, whose claim is a price to
      // pay.
      const free = await panel
        .locator('[data-tile][data-drop]:not(:has(img.taken)):not(:has(img.natives))')
        .evaluateAll((es) => es.map((e) => e.dataset.tile!));
      for (const id of free) {
        const place = panel.locator(`[data-tile="${id}"]`);
        await unit(founder).dragTo(place.locator('.hit'));
        if (await landed(place, founder, 10000)) {
          tileId = id;
          break;
        }
      }
      // The panel shows a tile the founder could work (it is not drawn taken, and is not native land), and
      // none took it: a click to a tile is broken, and that must not pass as a colony with no tile to work.
      if (!tileId && free.length > 0) {
        throw new Error(
          `the founder ${founder} is in ${start.place}, and no drag put it on any of the panel's tiles it could work: ${free.join(', ')}`,
        );
      }
      if (!tileId) {
        console.log(
          `  colony panel: the colony has no tile to work, so the founder ${founder} stays in ${start.place}`,
        );
      }
    }
    const tile = tileId === null ? null : panel.locator(`[data-tile="${tileId}"]`);
    const hall = panel.locator('[data-building]').first();
    const onTile = await net();

    // A right-click on the founder opens its quick action menu, with places to work; Escape closes the menu
    // and leaves the colony panel open.
    await unit(founder).click({ button: 'right' });
    const popup = page.locator('.popup[role=menu]');
    await popup.waitFor({ timeout: 10000, label: "the founder's quick action menu opens" });
    if ((await popup.locator('[data-entry^="work:"]').count()) === 0) {
      throw new Error(`the founder's quick action menu has no place to work: ${await popup.innerText()}`);
    }
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'detached', timeout: 5000, label: 'Escape closes the quick action menu' });
    if ((await panel.count()) !== 1) throw new Error('Escape closed the colony panel with the menu');

    // The same menu's "Show production modifiers" opens the work production panel of the colonist at work
    // (showWorkProductionPanel): what the founder makes there, with the modifiers behind the amount.
    await inspect(
      'the work production panel',
      'workProduction',
      'showWorkProductionPanel',
      async () => {
        await unit(founder).click({ button: 'right' });
        const menu = page.locator('.popup[role=menu]');
        await menu.waitFor({ timeout: 10000, label: "the founder's quick action menu opens for its production" });
        const entry = menu.locator('[data-entry^="production:"]');
        if ((await entry.count()) === 0) {
          throw new Error(`the founder's quick action menu has no production entry: ${await menu.innerText()}`);
        }
        await entry.click();
      },
      /\d/,
    );
    if ((await panel.count()) !== 1) throw new Error('the work production panel closed the colony panel');

    if (tile !== null) {
      // Drag the founder from its tile into a building.
      await dragInto(founder, hall, hall, 'into a building');
      const inHall = await changed(onTile, 'the founder was dragged into a building');
      if ((await tile.locator(`[data-unit="${founder}"]`).count()) > 0) {
        throw new Error('the founder is on its tile and in the building');
      }

      // Drag it back to its tile: back to work there.
      await dragInto(founder, tile.locator('.hit'), tile, 'back to its tile');
      await changed(inHall, 'the founder was dragged back to its tile');

      // Its menu changes what it makes, when the tile offers another.
      await unit(founder).click({ button: 'right' });
      const menu = page.locator('.popup[role=menu]');
      await menu.waitFor({ timeout: 10000, label: "the founder's menu opens again" });
      const work = menu.locator(`[data-entry^="work:${founder},${tileId},"]`);
      if ((await work.count()) > 0) {
        const entry = await work.first().getAttribute('data-entry');
        const goods = entry!.split(',')[2];
        await work.first().click();
        // The tile makes it now. (The net production would do, but it moves twice when a colonist returns to work.)
        await tile
          .locator(`[data-goods="${goods}"]`)
          .waitFor({ timeout: 20000, label: 'the tile shows the goods the founder was set to make' })
          .catch(() => {
            throw new Error(`the tile did not show ${goods} after the founder was set to make it`);
          });
      } else {
        await page.keyboard.press('Escape');
      }
    }

    // A colonist outside the colony goes to work, and out again.
    const outside = panel.locator('[data-part=outside]');
    const waiting = await outside.locator('[data-unit]').evaluateAll((es) => es.map((e) => e.dataset.unit!));
    const before = await net();
    // Not every unit left on the colony's tile can work in a building (a soldier cannot): the first that can does.
    let other: string | null = null;
    for (const id of waiting) {
      await unit(id).dragTo(hall);
      if (await landed(hall, id, 8000)) {
        other = id;
        break;
      }
    }
    if (other === null) throw new Error(`no colonist outside could be put to work in a building: ${String(waiting)}`);
    await changed(before, 'a colonist outside was put to work in a building');
    await dragInto(other, outside, outside, 'out of the building');

    // A colonist cannot work on a tile another colonist works: the Engine explains it, and the
    // explanation shows over the colony panel, as Swing's does, with the colony panel on screen again
    // once it is closed. A panel queued behind the colony panel would show only after the player closed
    // it, so the log must have the explanation while the panel is still open. With no tile to work there is
    // no worked tile to refuse.
    if (tile === null) {
      console.log('  colony panel: no worked tile, so no refusal to check');
    } else {
      const logged = await page.evaluate(() => window.__dialogs.length);
      // The colonist working the tile is drawn over its diamond, so the drop is forced onto it, as a player's lands on whatever is there.
      await unit(other).dragTo(tile.locator('.hit'), { force: true });
      await waitForDialog(logged, 'information: ', 'the refusal was not explained over the colony panel');
      await panel.waitFor({ timeout: 10000, label: 'the colony panel is still open after the refusal' });
    }

    // Queue a building the colony can build, from the build queue; the panel must list it as queued. (What
    // the server's colony does with the queue, and paying for it, are CommandsTest's to check.)
    await panel.locator('[data-part=construction]').click();
    const addable = panel.locator('[data-part=buildings] [data-buildable] button:not([disabled])');
    if ((await addable.count()) > 0) {
      const type = await addable.first().evaluate((e) => e.closest<HTMLElement>('[data-buildable]')!.dataset.buildable);
      await addable.first().click();
      await panel
        .locator(`[data-part=queued] [data-queued="${type}"]`)
        .waitFor({ timeout: 20000, label: 'the build queue shows the added building' })
        .catch(() => {
          throw new Error(`the build queue did not show ${type} after it was added`);
        });
    }
    // The queue's popup covers the panel until it is closed.
    await panel.locator('button.queue-close').click();
    await page.evaluate(() => (window.__hold = null));
    await panel.locator('[data-answer=close]').click();
    await noDialog('closing the colony panel');
    console.log(
      tile === null
        ? `  colony panel: moved ${other} to work and out again`
        : `  colony panel: moved ${founder} and ${other}`,
    );
    // What the run's summary says when the founder had no tile to work.
    return tile === null ? `the colony has no tile to work, so the founder ${founder} stayed in ${start.place}` : '';
  };
  /**
   * Sail the ship from the sea into the colony and load it in the colony panel as a player would: a unit
   * beside the colony boards it and goes ashore again, and goods of the warehouse, picked with shift so the
   * select amount dialog asks how much (the answerer keeps the amount it suggests), go aboard and come back.
   * Next turn the ship sails back out to sea. What the server does with the cargo is CommandsTest's to check.
   */
  const loadShip = async (m: MapView, land: Tile, sea: Tile) => {
    m = await select(m, sea);
    if (!same(m.active, sea)) throw new Error(`clicking ${label(sea)} selected ${label(m.active)}`);
    const shipId = m.activeUnit!.id;
    const dirs = Object.keys(DIRECTIONS) as Dir[];
    const into = dirs.find((d) => same(neighbour(sea, d), land));
    const out = dirs.find((d) => same(neighbour(land, d), sea));
    m = await act(() => pressKey(KEYS[into!]));
    // The map names the unit in front on a tile only, so the ship is found gone from the sea.
    if (m.units.some((u) => (u as Unit & { id?: string }).id === shipId)) {
      throw new Error(`the ship ${shipId} did not sail into the colony at ${label(land)}`);
    }

    await noDialog('opening the colony panel to load the ship');
    await page.evaluate(() => (window.__hold = 'colony'));
    await act(() => click(m, land));
    const panel = page.locator('[role=dialog][data-kind=colony]');
    await panel.waitFor({ timeout: 10000, label: 'the colony panel opens to load the ship' });
    const cargo = panel.locator(`[data-part=cargo][data-ship="${shipId}"]`);
    await cargo.waitFor({ timeout: 10000, label: "the colony panel shows the ship's cargo" }).catch(() => {
      throw new Error(`the colony panel does not show the cargo of the ship ${shipId}`);
    });
    const outside = panel.locator('[data-part=outside]');
    const warehouse = panel.locator('[data-part=warehouse]');

    // The panel is shown afresh as each change reaches the client, so a click can land as it is redrawn:
    // a place is clicked again until nothing is picked.
    // The Engine runs the commands one at a time, so a put waits for its command's closing map before
    // the next one goes.
    const putOn = async (place: Locator, what: string) => {
      const n = await page.evaluate(() => window.__maps);
      for (let i = 0; i < 5; i++) {
        await place.click();
        if ((await panel.locator('[data-picked=true]').count()) === 0) {
          await page.waitForFunction((n) => window.__maps > n, n, {
            timeout: 60000,
            label: 'the map after a pick is put down',
          });
          return;
        }
        await page.waitForTimeout(300);
      }
      throw new Error(`a click did not put ${what} down`);
    };
    /**
     * Drag a unit and goods of the warehouse onto the ship's cargo in one turn, as a player in a hurry
     * does: the second command comes while the first runs, so the Engine must queue it rather than lose
     * it (#98). The drags are dispatched together, so that both commands reach the Engine before either
     * of them has run.
     */
    const dropBoth = async (unitId: string, goodsType: string, shipId: string) => {
      await page.evaluate(
        ([unit, goods, ship]: [string, string, string]) => {
          // A player's drag, as the pointer's events: press, move onto the place, let go there. The panel reads
          // shift from the press (the mouse's), and as the drag starts.
          const fire = (el: Element, type: string, x: number, shift: boolean) =>
            el.dispatchEvent(
              new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, shiftKey: shift }),
            );
          const drag = (el: Element, onto: Element, shift: boolean) => {
            fire(el, 'pointerdown', 0, shift);
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: shift }));
            fire(onto, 'pointermove', 20, shift);
            fire(onto, 'pointerup', 20, shift);
          };
          const one = document.querySelector(`[data-part=outside] [data-unit="${unit}"]`);
          const two = document.querySelector(`[data-part=warehouse] [data-goods="${goods}"]`);
          const place = document.querySelector(`[data-part=cargo][data-ship="${ship}"]`);
          if (!one || !two || !place) throw new Error('the colony panel does not show what to drop');
          drag(one, place, false);
          drag(two, place, true);
        },
        [unitId, goodsType, shipId] as [string, string, string],
      );
    };

    // A unit beside the colony and goods of the warehouse go aboard in one turn, and both must land: the
    // second command comes while the first runs. The goods are shift-picked, so the amount is asked.
    // The warehouse lists goods from the display threshold up, which can be none at all.
    const passenger = await outside.locator('[data-unit]').first().getAttribute('data-unit');
    if (!passenger) throw new Error('no unit beside the colony to board the ship');
    const goods = await warehouse
      .locator('[data-goods]')
      .evaluateAll((es) => es.find((e) => Number(e.querySelector('.amount')?.textContent) > 0)?.dataset.goods ?? null);
    if (!goods) throw new Error('the colony has no goods in its warehouse to load');
    const before = await page.evaluate(() => window.__dialogs.length);
    await dropBoth(passenger, goods, shipId);
    await cargo
      .locator(`[data-unit="${passenger}"]`)
      .waitFor({ timeout: 20000, label: "the passenger shows in the ship's cargo" })
      .catch(() => {
        throw new Error(`the unit ${passenger} did not board the ship`);
      });
    await cargo
      .locator(`[data-goods="${goods}"]`)
      .first()
      .waitFor({ timeout: 20000, label: "the goods show in the ship's cargo" })
      .catch(() => {
        throw new Error(`the ship did not take ${goods} aboard`);
      });
    await waitForDialog(before, 'amount: ', 'loading with shift did not ask the amount');
    // The passenger goes ashore again.
    await cargo.locator(`[data-unit="${passenger}"]`).dragTo(outside);
    await outside
      .locator(`[data-unit="${passenger}"]`)
      .waitFor({ timeout: 20000, label: 'the passenger shows outside the ship again' })
      .catch(() => {
        throw new Error(`the unit ${passenger} did not leave the ship`);
      });
    // The goods come ashore again.
    await pickUp(cargo.locator(`[data-goods="${goods}"]`).first(), goods);
    await putOn(warehouse, goods);
    await page
      .waitForFunction(
        ([ship]) => !document.querySelector(`[data-part=cargo][data-ship="${ship}"] [data-goods]`),
        [shipId],
        { timeout: 20000, label: "the ship's cargo has no goods left" },
      )
      .catch(() => {
        throw new Error(`the ship did not unload ${goods}`);
      });
    // The warehouse button opens the warehouse dialog: an export level set there is there when it is reopened.
    const warehouseDialog = page.locator('[role=dialog][data-kind=warehouse]');
    const exportLevel = warehouseDialog.locator('fieldset input[aria-label$=" export"]').first();
    for (const level of ['37', '38']) {
      await panel.locator('.buttons button:not([data-answer])').click();
      await warehouseDialog.waitFor({ timeout: 10000, label: 'the warehouse dialog opens' });
      if (level === '38' && (await exportLevel.inputValue()) !== '37') {
        throw new Error('the warehouse dialog did not keep the export level set before');
      }
      await exportLevel.fill(level);
      await warehouseDialog.locator('[data-answer=ok]').click();
      await warehouseDialog.waitFor({ state: 'detached', timeout: 10000, label: 'the warehouse dialog closes' });
    }
    console.log('  colony panel: the warehouse dialog sets an export level');
    await page.evaluate(() => (window.__hold = null));
    await panel.locator('[data-answer=close]').click();
    await noDialog('closing the colony panel after loading the ship');

    // Back to sea, next turn: the panel's commands leave no unit active, and a new turn chooses one, from
    // which the ship is reached as the next unit with moves left.
    m = await endTurn();
    for (let i = 0; i < 8 && m.activeUnit?.id !== shipId; i++) m = await act(() => pressKey('w'));
    if (m.activeUnit?.id !== shipId) {
      throw new Error(
        `the ship ${shipId} could not be selected in the colony: active ${m.activeUnit?.id} at ${label(m.active)}`,
      );
    }
    m = await act(() => pressKey(KEYS[out!]));
    if (!same(m.active, sea)) throw new Error(`the ship did not sail back to ${label(sea)}: at ${label(m.active)}`);
    console.log(`  colony panel: ${passenger} boarded the ship and left it, ${goods} loaded and unloaded`);
    return m;
  };
  const viewState = () => page.evaluate(() => window.fcView!());
  /** The view is on the client's active unit: the cursor on its tile, in view, and the panel naming it. */
  const following = async (m: MapView, what: string) => {
    await settled();
    const v = await viewState();
    if (!m.activeUnit || v.active?.unit !== m.activeUnit.id || !same(v.cursor?.at, m.active)) {
      throw new Error(
        `${what}: the view's active unit ${JSON.stringify(v.active)} is not the client's ${m.activeUnit?.id} at ${label(m.active)}`,
      );
    }
    // The view's own geometry (tileOnScreen in ui/src/view.ts, unit-tested
    // there) places the cursor; clicks through fcReveal rely on the same maths.
    const [px, py] = v.cursorOnScreen!;
    if (px < 0 || py < 0 || px > v.viewport[0] || py > v.viewport[1]) {
      throw new Error(`${what}: the active unit at ${label(m.active)} is out of view`);
    }
    // React renders the panel a moment after the view changes.
    const shows = (label: string) => document.querySelector('#info')?.textContent!.startsWith(label);
    if (
      !(await page
        .waitForFunction(shows, m.activeUnit.label, { timeout: 5000, label: 'the info panel names the active unit' })
        .catch(() => false))
    ) {
      const info = await page.locator('#info').textContent();
      throw new Error(`${what}: the panel shows ${JSON.stringify(info)}`);
    }
  };
  /**
   * The menu bar must span the top of the window, and the map canvas fill the window below it up to the side
   * panel, which must reach the window's right edge.
   */
  const laidOut = async (what: string) => {
    // These run in the page, so neither can call the other.
    const boxes = () => {
      const c = document.querySelector('#map canvas')!.getBoundingClientRect();
      const s = document.querySelector('#side')!.getBoundingClientRect();
      const m = document.querySelector('.menubar')!.getBoundingClientRect();
      return {
        menubar: [m.left, m.right, m.top, m.bottom],
        canvas: [c.left, c.right, c.top, c.bottom],
        side: [s.left, s.right],
        window: [innerWidth, innerHeight],
      };
    };
    const fills = () => {
      const c = document.querySelector('#map canvas')!.getBoundingClientRect();
      const s = document.querySelector('#side')!.getBoundingClientRect();
      const m = document.querySelector('.menubar')!.getBoundingClientRect();
      const bar = m.top === 0 && m.height > 0 && m.left === 0 && m.right === innerWidth;
      return (
        bar &&
        c.left === 0 &&
        c.right <= s.left &&
        s.right === innerWidth &&
        c.top === m.bottom &&
        c.bottom === innerHeight
      );
    };
    if (
      !(await page
        .waitForFunction(fills, null, { timeout: 5000, label: 'the map and the side panel fill the window' })
        .catch(() => false))
    ) {
      const got = await page.evaluate(boxes);
      throw new Error(`${what}: the map and the side panel do not fill the window: ${JSON.stringify(got)}`);
    }
  };
  /** Widen the side panel: the map must make room for it, and fill the window again once it narrows. */
  const widenSide = async () => {
    const style = await page.addStyleTag({ content: '#side { width: 600px; }' });
    await laidOut('with a wider side panel');
    await style.evaluate((s) => (s as Element).remove());
    await laidOut('with the side panel back');
  };
  /** Shrink the window: the map canvas and the view's viewport must shrink with it. */
  const resize = async () => {
    await laidOut('before a resize');
    const before = (await viewState()).viewport;
    const [dw, dh] = [300, 200];
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width - dw, height: size.height - dh });
    const want = [before[0] - dw, before[1] - dh];
    // These run in the page, so neither can call the other.
    const canvasSize = () => {
      const c = document.querySelector<HTMLCanvasElement>('#map canvas');
      return [c?.width, c?.height];
    };
    // The canvas's CSS box is the viewport's size, in CSS pixels, and its
    // backing store is that many device pixels: the map is drawn at the
    // screen's pixel ratio.
    const fits = ([w, h]: number[]) => {
      const c = document.querySelector<HTMLCanvasElement>('#map canvas');
      const [vw, vh] = window.fcView!().viewport;
      const r = window.devicePixelRatio || 1;
      const box = c?.getBoundingClientRect();
      return (
        box?.width === w &&
        box.height === h &&
        c!.width === Math.round(w * r) &&
        c!.height === Math.round(h * r) &&
        vw === w &&
        vh === h
      );
    };
    if (
      !(await page
        .waitForFunction(fits, want, { timeout: 5000, label: 'the canvas has the size of the resized window' })
        .catch(() => false))
    ) {
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
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const before = await viewState();
    await page.mouse.move(cx, cy);
    // mouse.wheel does not wait for the page to handle the event (Firefox
    // may be late), so wait for the zoom to change.
    await page.mouse.wheel(0, -100);
    await page
      .waitForFunction((z) => window.fcView!().zoom > z, before.zoom, {
        timeout: 5000,
        label: 'the wheel zooms the map in',
      })
      .catch(() => {});
    const zoomed = await viewState();
    if (zoomed.zoom <= before.zoom) throw new Error(`the wheel did not zoom in: ${before.zoom} -> ${zoomed.zoom}`);
    // Drag the map right with the middle button, the only one that pans, so it has room to scroll back at the right edge.
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 150, cy + 100, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
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
  const click = async (m: MapView, [x, y]: Tile) => {
    await settled();
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py);
  };

  /** A right-click on our colony's tile opens the tile popup with the colony in it; a click elsewhere closes it. */
  const tilePopup = async (m: MapView, [x, y]: Tile) => {
    await settled();
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [x, y]);
    await page.mouse.click(box.x + px, box.y + py, { button: 'right' });
    const popup = page.locator('.popup[role=menu]');
    await popup.waitFor({ timeout: 10000, label: 'the tile popup opens' });
    if ((await popup.locator('[data-entry^="colony:"]').count()) === 0) {
      throw new Error(`the tile popup of the colony has no colony entry: ${await popup.innerText()}`);
    }
    // The popup's tile entry (the tile's label) opens the tile panel (showTilePanel), which names the terrain.
    await inspect(
      'the tile panel',
      'tilePanel',
      'showTilePanel',
      async () => {
        await popup.locator('[data-entry^="tile:"]').click();
        await popup.waitFor({ state: 'detached', timeout: 5000, label: 'the tile entry closes the popup' });
      },
      /\S{3}/,
    );
    await page.mouse.click(box.x + px, box.y + py, { button: 'right' });
    await popup.waitFor({ timeout: 10000, label: 'the tile popup opens again' });
    // The map's top-left corner: the minimap is at its bottom-left.
    await page.mouse.click(box.x + 5, box.y + 5);
    await popup.waitFor({ state: 'detached', timeout: 5000, label: 'a click elsewhere closes the tile popup' });
    console.log('  tile popup: right-click opens the colony tile menu, a click elsewhere closes it');
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
  // The ship sails for the nearest land whose colony has a tile to work, so
  // that FreeCol puts the founder on a tile and not in the town hall, unless
  // that land is much farther off than the nearest land, which it takes
  // then: the crossing is long, and the script puts the founder to work
  // itself when the colony has a tile to work.
  let land: Tile | null = null;
  const firstTurn = m.turn;
  // Where the ship was last seen: the map names no active unit when the ship
  // is out of moves, and then it names no place either.
  let place: Tile | null = null;
  const visited = new Set<string>();
  const trail: string[] = [];
  for (let turns = 0; !land;) {
    if (m.active) {
      place = m.active;
      visited.add(label(m.active));
      trail.push(`t${m.turn}@${label(m.active)}`);
    }
    const step = m.active && bestLand(m, m.active, visited);
    if (!step || !step.dir) {
      if (++turns > MAX_TURNS) {
        throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(place)}; trail ${trail.join(' ')}`);
      }
      m = await endTurn(true);
      continue;
    }
    const ship = m.active;
    m = await act(() => pressKey(KEYS[step.dir!]));
    if (m.activeUnit) await following(m, 'after a move');
    if (step.tile && at(m.units, step.tile)) land = step.tile;
    else if (same(m.active, ship)) {
      // The ship could not move: out of moves or blocked.
      if (++turns > MAX_TURNS) {
        throw new Error(`no land within ${MAX_TURNS} turns; the ship is at ${label(ship)}`);
      }
      m = await endTurn(true);
    }
  }

  // Turns taken to reach the land, counted from the first turn.
  console.log(
    `  landed on turn ${m.turn} (${(m.turn as unknown as number) - (firstTurn as unknown as number)} turns of sailing after the first)`,
  );

  // The ship is the active unit while it sails: remember where it is, to
  // select it and fortify it later.
  const shipTile = m.active!;

  // The landed units have no moves left: next turn, select one and build.
  m = await endTurn();
  m = await select(m, land!);
  if (!same(m.active, land)) throw new Error(`clicking ${label(land)} selected ${label(m.active)}`);
  await following(m, 'after selecting a unit');
  const founder = m.activeUnit!.id;
  m = await act(() => pressKey('b'));
  if (!at(m.settlements, land!)) throw new Error(`no colony at ${label(land)}`);
  // The controller opens the colony panel after founding, with the founder working in the colony.
  const panelShowsFounder = await page
    .waitForFunction(
      (id) => (window.__dialogUnits ?? []).some((d) => d.kind === 'colony' && d.units.includes(id)),
      founder,
      { timeout: 10000, label: 'the colony panel shows the founder' },
    )
    .catch(() => false);
  if (!panelShowsFounder) {
    const seen = await page.evaluate(() => window.__dialogUnits);
    throw new Error(`the colony panel did not show the founder ${founder}: ${JSON.stringify(seen)}`);
  }
  const note = await moveColonists(m, land!, founder);
  await tilePopup(m, land!);
  m = await endTurn();
  if (!at(m.settlements, land!)) throw new Error(`the colony at ${label(land)} is gone after the AI turn`);

  // The Trade routes button asks the Engine for the panel, which the page shows (the dialog answerer
  // closes it). Making, changing and deleting routes is CommandsTest's and panels.test.tsx's to check.
  // The panel is held open to open the route editor from its New button.
  await noDialog('the Trade routes button');
  await page.evaluate(() => (window.__hold = 'tradeRoutes'));
  m = await act(() => page.click('button[data-command=tradeRoutes]'));
  const routesShown = await page
    .waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('tradeRoutes: ')), null, {
      timeout: 10000,
      label: 'the trade routes panel opens',
    })
    .catch(() => false);
  if (!routesShown) {
    throw new Error(
      `the trade routes panel did not open: ${JSON.stringify(await page.evaluate(() => window.__dialogs))}`,
    );
  }
  // New opens the route editor (showTradeRouteInputPanel) over the list, with a name to give the route; Add stop
  // puts a stop in the route, which the editor then lists; Cancel goes back to the list, and OK closes it.
  {
    const routes = page.locator('[role=dialog][data-kind=tradeRoutes]');
    await routes.locator('[data-answer=new]').click();
    const editor = routes.locator('[data-answer=addStop]');
    await editor.waitFor({ timeout: 10000, label: 'the New button opens the route editor' });
    await editor.click();
    await routes.locator('[data-stop]').first().waitFor({ timeout: 10000, label: 'Add stop adds a stop to the route' });
    const text = await routes.innerText();
    if (!(await routes.locator('input').first().inputValue()) || /undefined|NaN|\[object/.test(text)) {
      throw new Error(`the trade route editor shows no route name or an unset value: ${text.slice(0, 300)}`);
    }
    await page.screenshot({ path: shot('showTradeRouteInputPanel') });
    console.log(`  trade route editor: ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
    await routes.locator('[data-answer=cancel]').click();
    await routes
      .locator('[data-route], [data-answer=new]')
      .first()
      .waitFor({ timeout: 10000, label: 'Cancel returns to the routes list' });
    await page.evaluate(() => (window.__hold = null));
    await routes.locator('[data-answer=close]').click();
    await routes.waitFor({ state: 'detached', timeout: 10000, label: 'OK closes the routes panel' });
  }

  // The Report menu opens each report, as a player would: its window is the dialog the answerer then
  // closes. The colony report shows the colonists of our colony. Their figures are ReportsTest's to check.
  for (const [item, title] of [
    ['Colony report', 'Colony Advisor'],
    ['Labour report', 'Labor Advisor'],
    ['Compact labour report', 'Labor Advisor'],
    ['Military report', 'Military Advisor'],
    ['Naval report', 'Naval Advisor'],
    ['Cargo report', 'Cargo Report'],
    ['Education report', 'Education Report'],
    ['Exploration report', 'Exploration Report'],
    ['History report', 'History Report'],
    ['Production report', 'Production Report'],
    ['Religion report', 'Religious Advisor'],
    ['Requirements report', 'Requirements'],
    ['Trade report', 'Trade Advisor'],
  ]) {
    await noDialog(`opening the ${item}`);
    const logged = await page.evaluate(() => window.__dialogs.length);
    await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
    // The entry's name ends with its hotkey hint, when it has one.
    await page.getByRole('menuitem', { name: new RegExp(`^${item}( (Ctrl\\+)?(Shift\\+)?F\\d+)?$`) }).click();
    await waitForDialog(logged, `report: ${title}`, `the ${item} did not open`);
    if (item === 'Colony report') {
      const named = await page.evaluate(
        (id) => window.__dialogUnits.some((d) => d.kind === 'report' && d.units.includes(id)),
        founder,
      );
      if (!named) throw new Error(`the colony report does not show the founder ${founder}`);
    }
  }

  // The three reports the loop above leaves out are looked at, held open and shot: the Continental Congress,
  // the foreign powers and the natives (the Report menu's entries), and the labour report's click on a kind
  // of colonist, which opens the labour detail report.
  const reportEntry = (item: string) => async () => {
    await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${item}( (Ctrl\\+)?(Shift\\+)?F\\d+)?$`) }).click();
  };
  await inspect(
    'the Continental Congress report',
    'report',
    'showReportContinentalCongressPanel',
    reportEntry('Continental Congress report'),
    /Congress|Father|Liberty|Bells/i,
  );
  await inspect(
    'the foreign affairs report',
    'report',
    'showReportForeignAffairPanel',
    reportEntry('Foreign affairs report'),
    /Foreign|Dutch|English|French|Spanish/i,
  );
  await inspect(
    'the native affairs report',
    'report',
    'showReportIndianPanel',
    reportEntry('Native affairs report'),
    /Native|Indian|Tribe|Arawak|Aztec|Cherokee|Inca|Iroquois|Sioux|Apache|Tupi|Contact/i,
  );
  await inspect(
    'the labour detail report',
    'report',
    'showReportLabourDetailPanel',
    async () => {
      await reportEntry('Labour report')();
      const type = page.locator('[role=dialog][data-kind=report] button.labour-type:not([disabled])').first();
      await type.waitFor({ timeout: 10000, label: 'the labour report lists a kind of colonist we have' });
      await type.click();
    },
    /Details/,
    '[data-answer=close]',
    async (d) => {
      await d
        .locator('.labour-detail')
        .waitFor({ timeout: 10000, label: 'a click on a kind of colonist opens its detail' });
      if ((await d.locator('.labour-detail dl > div').count()) === 0)
        throw new Error('the labour detail lists no place');
    },
  );

  m = await loadShip(m, land!, shipTile);

  // The ship is at sea again: select it and fortify it, as a player would.
  // The side panel's Fortify button follows the Engine's orders, and the
  // ship is drawn in grey once its turn has ended.
  m = await select(m, shipTile);
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship');
  const fortify = page.locator('button[data-command=fortify]');
  if (await fortify.isDisabled()) throw new Error('the ship cannot be fortified');
  // The order buttons over the map must be on top, with the side panel shown and hidden: the map's canvas
  // once painted over them (#245). The ship is fortified with a real click on the map's Fortify button,
  // which must not reach the map's own click listener.
  await ordersOnTop('with the side panel shown');
  await page.keyboard.press('Shift+F11');
  await ordersOnTop('with the side panel hidden');
  await page.keyboard.press('Shift+F11');
  await ordersOnTop('with the side panel shown again');
  await page.evaluate(() => {
    window.__mapClicked = false;
    document.querySelector('#map')!.addEventListener('click', () => (window.__mapClicked = true), { once: true });
  });
  m = await act(async () => {
    const b = (await page.locator('#map-orders [data-order=fortify]').boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  });
  if (await page.evaluate(() => window.__mapClicked)) throw new Error('a click on an order button reached the map');
  m = await endTurn();
  const ship = m.units.find((u) => u.x === shipTile[0] && u.y === shipTile[1]);
  if (!ship || ship.fg !== FORTIFIED) {
    throw new Error(`the ship at ${label(shipTile)} is not fortified: ${JSON.stringify(ship)}`);
  }

  // The Go To order, as GotoAction binds it: the player must be asked
  // where the ship sails. Where it goes is CommandsTest's to check. The ship
  // is the active unit again, as it was when it was fortified.
  m = await select(m, shipTile);
  if (!same(m.active, shipTile)) throw new Error(`clicking ${label(shipTile)} selected ${label(m.active)}`);
  await following(m, 'after selecting the ship for the Go To order');
  await act(() => pressKey('h'));
  const asked = await page
    .waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('choice: Select destination')), null, {
      timeout: 10000,
      label: 'the Go To order asks for a destination',
    })
    .catch(() => false);
  if (!asked) {
    const dialogs = await page.evaluate(() => window.__dialogs);
    throw new Error(`the Go To order did not ask for a destination: ${JSON.stringify(dialogs)}`);
  }

  // The Europe button opens FreeCol's Europe panel: its headings and lists, and the market's goods with
  // each one's sell/buy price. The panel is read while it is shot, before the script closes it.
  await noDialog('pressing the Europe button');
  await page.locator('button[data-command=showEurope]').click();
  await page.waitForFunction(() => (window.__dialogs ?? []).some((d) => d.startsWith('europe: ')), null, {
    timeout: 10000,
    label: 'the Europe panel opens',
  });
  for (let i = 0; i < 200 && europeSeen.length === 0; i++) await new Promise((ok) => setTimeout(ok, 50));
  const europe = europeSeen[0];
  if (!europe) throw new Error('the Europe button showed no Europe panel with images to shoot');
  const lists = ['toAmerica', 'toEurope', 'inPort', 'docks', 'cargo', 'market'];
  if (!europe.headings[0] || europe.headings.length < 6 || !lists.every((l) => europe.lists.includes(l))) {
    throw new Error(`the Europe panel lacks FreeCol's headings or lists: ${JSON.stringify(europe)}`);
  }
  if (europe.goods < 10 || !europe.prices.every((p) => /^\d+\/\d+$/.test(p!))) {
    throw new Error(`the Europe panel's market is wrong: ${JSON.stringify(europe)}`);
  }

  // The Recruit, Train and Purchase buttons list what Europe sells, with prices; the Set sail button needs
  // a ship in port, which this game does not have yet. SelectDestinationTest does the buying and sailing.
  if (
    europe.recruits !== 3 ||
    europe.trains < 1 ||
    europe.buys.length < 1 ||
    !europe.buys.every((p) => /\d/.test(p!)) ||
    !europe.sailDisabled
  ) {
    throw new Error(`Europe's recruit, train or purchase list or its sail button is wrong: ${JSON.stringify(europe)}`);
  }

  // The Report menu's entries show the game's difficulty level and game options in the option editor, read-only.
  for (const [entry, kind] of [
    ['Show Difficulty Level', 'difficulty'],
    ['Show Game Options', 'game'],
    ['Show Map Generator Options', 'map generator'],
  ]) {
    await noDialog(`the ${kind} options entry`);
    await page.evaluate(() => (window.__hold = 'options'));
    await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
    await page.getByRole('menuitem', { name: entry }).click();
    await page.waitForSelector('[role=dialog][data-kind=options] [data-option]', {
      timeout: 10000,
      label: 'the options dialog lists its options',
    });
    const editor = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          '[role=dialog][data-kind=options] [data-option] :is(input, select)',
        ),
      ];
      return { options: controls.length, editable: controls.filter((c) => !c.disabled).length };
    });
    if (editor.options < 10 || editor.editable > 0) {
      throw new Error(
        `the ${kind} options panel is not a read-only editor of the game's options: ${JSON.stringify(editor)}`,
      );
    }
    await page.screenshot({
      path: shot(
        {
          'map generator': 'showMapGeneratorOptionsDialog',
          difficulty: 'showDifficultyDialog',
          game: 'showGameOptionsDialog',
        }[kind]!,
      ),
    });
    await page.evaluate(() => (window.__hold = null));
    await page.click('[role=dialog][data-kind=options] [data-answer=close]');
  }

  // View > Find Settlement, and its key Ctrl+F, list the settlements the player knows (showFindSettlementPanel),
  // our colony among them, with a filter; Escape closes it.
  const settlements = async (d: Locator) => {
    const names = await d.locator('[role=option]').evaluateAll((es) => es.map((e) => e.textContent!.trim()));
    if (names.length === 0) throw new Error('the find settlement panel lists no settlement');
    return names;
  };
  await inspect(
    'the find settlement panel (View menu)',
    'findSettlement',
    'showFindSettlementPanel',
    async () => {
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Find Settlement/ }).click();
    },
    /\S{3}/,
    '[data-answer=close]',
    settlements,
  );
  await inspect(
    'the find settlement panel (Ctrl+F)',
    'findSettlement',
    'showFindSettlementPanel-ctrl-f',
    () => page.keyboard.press('Control+f'),
    /\S{3}/,
    '[data-answer=close]',
    settlements,
  );

  // The page's own windows, which FreeCol's Swing opens from its own menus: Game > Preferences (Ctrl+P) with
  // FreeCol's client options by category, Game > Open with the saves and a file to open, Colopedia > About
  // BrowserCol with its credits.
  const prefs = await inspect(
    'the Preferences window',
    'preferences',
    'showClientOptionsDialog',
    async () => {
      await page.getByRole('menuitem', { name: 'Game', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Preferences/ }).click();
    },
    /Preferences/,
    '[data-prefs-ok]',
    async (d) => {
      const categories = await d
        .locator('[data-category]')
        .evaluateAll((es) => es.map((e) => e.getAttribute('data-category')!));
      if (categories.length < 5) throw new Error(`Preferences has too few categories: ${categories.join(', ')}`);
      // A click on another category shows that one's options.
      const shown = await d.locator('[data-shown]').getAttribute('data-shown');
      const other = categories.find((c) => c !== shown)!;
      await d.locator(`[data-category="${other}"]`).click();
      await d.locator(`[data-shown="${other}"]`).waitFor({ timeout: 5000, label: 'a click on a category shows it' });
      if (
        (await d
          .locator(
            `[data-shown="${other}"] input, [data-shown="${other}"] select, [data-shown="${other}"] [role=combobox]`,
          )
          .count()) === 0
      ) {
        throw new Error(`the Preferences category ${other} has no option to set`);
      }
      return categories;
    },
  );
  console.log(`  Preferences categories: ${prefs.found.join(', ')}`);
  await inspect(
    'the Open Game window',
    'open-game',
    'showLoadDialog',
    async () => {
      await page.getByRole('menuitem', { name: 'Game', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Open/ }).click();
    },
    /Open Game/,
    '[data-open-cancel]',
    async (d) => {
      if ((await d.locator('[data-open-file]').count()) === 0)
        throw new Error('the Open Game window has no file to open');
    },
  );
  await inspect(
    'the About window',
    'credits',
    'showAboutPanel',
    async () => {
      await page.getByRole('menuitem', { name: 'Colopedia', exact: true }).click();
      await page.getByRole('menuitem', { name: 'About BrowserCol' }).click();
    },
    /About BrowserCol.*GNU General Public License/s,
    'button.close',
  );

  // The error panel's "Show log" button opens the log (showLogFilePanel). A real error is rare, so the panel is
  // asked for as a player in debug mode does: View > Debug Mode, then Debug > Display panels > Display error message.
  await noDialog('turning debug mode on');
  const debugMode = () => page.getByRole('menuitemcheckbox', { name: /^Debug Mode/ });
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await debugMode().click();
  await page
    .getByRole('menuitem', { name: 'Debug', exact: true })
    .waitFor({ timeout: 10000, label: 'debug mode adds the Debug menu' });
  const log = await inspect(
    'the log window',
    'log',
    'showLogFilePanel',
    async () => {
      // The error panel stays open as well, for its Show log button.
      await page.evaluate(() => (window.__hold = 'error,log'));
      await page.getByRole('menuitem', { name: 'Debug', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Display panels' }).click();
      await page.getByRole('menuitem', { name: 'Display error message' }).click();
      await page.locator('[role=dialog][data-kind=error]').waitFor({ timeout: 10000, label: 'the error panel opens' });
      await page.locator('[role=dialog][data-kind=error] button:has-text("log")').first().click();
    },
    /Server Engine.*Client Engine/s,
    '[data-answer=close]',
  );
  await page.evaluate(() => (window.__hold = null));
  await page.locator('[role=dialog][data-kind=error] [data-answer=close]').click();
  await noDialog('closing the error panel');
  // Ctrl+Shift+D turns debug mode off again.
  await page.keyboard.press('Control+Shift+D');
  await page
    .getByRole('menuitem', { name: 'Debug', exact: true })
    .waitFor({ state: 'detached', timeout: 10000, label: 'debug mode off removes the Debug menu' });
  void log;

  // The art the dialogs show, from events as the client Engine sends them (the page's fcShow): the
  // event panel's two flavour images, and a turn report with the image of each kind of object, and
  // its group by option and buttons. The real game gives few of these in its first turns.
  const show = async (kind: string, event: unknown) => {
    await noDialog(`showing the ${kind} event`);
    const before = await page.evaluate(() => window.__pictures.length);
    await page.evaluate(([k, json]) => window.fcShow(k, json), [kind, JSON.stringify(event)]);
    await page
      .waitForFunction((n) => window.__pictures.length > n, before, {
        timeout: 10000,
        label: 'the event dialog shows its images',
      })
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
  const message = (text: string, type: string, images: string[], more = {}) => ({
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
  return { land, turn: m.turn, note };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: scale });
  const errors = collectPageErrors(page);
  const t = Date.now();
  let result: Result;
  try {
    result = await play(page, `${server.url}?skipstart${query ? `&${query}` : ''}`);
    await page.evaluate(([x, y]) => window.fcReveal!(x, y), result.land!);
    await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) });
  } catch (ex) {
    result = { error: await diagnose(ex) };
  }
  // The page may be too stuck to shoot: that must not replace the failure with a bare screenshot timeout.
  await page.screenshot({ path: path.join(dist, `../.cache/play-${name}.png`) }).catch((ex) => {
    console.log(`  the final screenshot failed: ${String(ex).split('\n')[0]}`);
  });
  const log = await dialogLog(page).catch(() => ({ dialogs: [], texts: [], pictures: [], unasked: [] }));
  const { dialogs, pictures } = log;
  // The art of the dialogs must have loaded, and the first landing's event panel must have had its image.
  const broken = pictures.filter((p) => !p.loaded);
  if (!result.error && broken.length > 0) result = { error: `dialog images did not load: ${JSON.stringify(broken)}` };
  if (!result.error && !pictures.some((p) => p.kind === 'eventPanel' && /landing/.test(p.src!))) {
    result = { error: `the first landing's event panel showed no image: ${JSON.stringify(pictures)}` };
  }
  // The panel above is the one the script injects (kind eventPanel). The game's own is asked by the Engine
  // (kind event) when the new land is named, and closing it adds the build colony tutorial message.
  if (!result.error && !pictures.some((p) => p.kind === 'event' && /landing/.test(p.src!))) {
    result = { error: `the Engine did not ask the first landing's event panel: ${dialogs.join(' | ')}` };
  }
  // The tutorial is a model message, shown by nextModelMessage with any others that are queued, so it may
  // be one of several in a messages dialog, not the first.
  const landing = log.texts.findIndex((d) => d.startsWith('event: '));
  if (!result.error && !log.texts.slice(landing + 1).some((d) => /^messages: .*Try building a Colony/.test(d))) {
    result = { error: `the build colony tutorial did not follow the first landing: ${log.texts.join(' | ')}` };
  }
  const { unasked } = log;
  await browser.close();
  failed ||= Boolean(result.error) || errors.length > 0 || unasked.length > 0;
  console.log(
    `${name} ${browser.version()}: ` +
      (result.error ? `failed: ${result.error}` : `colony at ${label(result.land)}, play back on turn ${result.turn}`) +
      (result.note ? `, ${result.note}` : '') +
      `, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      `\n  dialogs: ${dialogs.join(' | ')}` +
      (shotTimes.length ? `\n  screenshots: ${shotTimes.join(' | ')}` : '') +
      `\n  images: ${pictures.map((p) => `${p.kind} ${p.src}`).join(' | ')}` +
      (unasked.length ? `\n  no dialog yet for: ${unasked.join(', ')}` : '') +
      (errors.length ? `\n  page errors: ${errors.join('; ')}` : ''),
  );
}
server.close();
process.exit(failed ? 1 : 0);
