// Browser check of the touch screen (#510), on the built site, in touch contexts shaped like a phone and a tablet held
// in landscape (common.ts, newTouchPage): a Pixel on Chromium, an iPhone and an iPad on WebKit. Per device:
//   - the start screen is used by taps, the game starts, the rotate notice is hidden in landscape and shown in portrait,
//     and the layout is as wide as the device (the viewport meta works);
//   - the map: a tap fills the info panel's tile, a finger drag pans, a pinch zooms and snaps to a level, a long press
//     opens the tile popup, a double-tap on a colony opens it;
//   - the order bar has Wait, Go to and Next unit on tile; Wait moves to the next unit; Go to by taps shows the path
//     and a second tap sends the unit;
//   - panels: a long press on a colonist opens its menu, on a Tip trigger shows the tip, a tap elsewhere closes both;
//     a menu bar menu opens by a tap and another title switches it;
//   - the colony: a colonist is dragged by a finger onto a building and moved by two taps, and Escape puts a pick down
//     without closing the window; Europe: a cargo unit goes to the docks by two taps;
//   - a hidden page (pagehide) in our turn saves to "Background autosave", and the start screen offers to resume it;
//   - the mouse is unchanged: in a non-touch Chromium page a held press still starts a Go To, a right-click a popup.
//   - sheets (#511, docs/adr/0012): on a phone a window opened from the menu bar, the colony and Europe are full-screen
//     sheets (they fill the safe area, with a top bar and a back button of at least 44 px), a window opened from
//     another (Europe's purchase list) is a sheet over it, and its back button returns to the one under it;
// The iPad only starts a game and plays a turn (order bar, Skip, End Turn). Chromium's fingers are real touches over
// the DevTools protocol (Input.dispatchTouchEvent). WebKit's Playwright can only tap (page.touchscreen), so its taps are
// real and its drag, pinch and long press are touch PointerEvents sent to the page (the game listens to pointer
// events, not to touch events), with no WebKit gesture recogniser or browser hit test behind them.
// Screenshots go to .cache/touch/. Exits non-zero unless every check passes. Run after `just build` in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/touch.ts [--browsers chromium,webkit] [--devices pixel,iphone,ipad]
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, CDPSession, Locator, Page } from 'playwright-core';
import {
  collectPageErrors,
  diagnose,
  launchBrowser,
  newTouchPage,
  opt,
  sheetProblems,
  TOUCH_DEVICES,
  waitForResult,
  type BrowserName,
  type TouchDevice,
} from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const shotDir = path.resolve(import.meta.dirname, '../../.cache/touch');
fs.mkdirSync(shotDir, { recursive: true });
const server = await serveDist();
const wanted = opt('devices', 'pixel,iphone,ipad').split(',') as TouchDevice[];
const only = opt('browsers', 'chromium,webkit').split(',');
/** Which parts to run, for working on one: start (start screen, order bar, background save), map (map, bars, colony), europe, mouse. */
const parts = opt('parts', 'start,map,europe,mouse').split(',');
const timeout = 300_000;
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2];

let failed = false;
let label = '';
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${name}${detail ? ' (' + detail + ')' : ''}`);
  failed ||= !ok;
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Pt = readonly [number, number];

/** A finger: real touches on Chromium, taps on WebKit's touch screen and touch PointerEvents for the rest. */
interface Finger {
  tap(x: number, y: number): Promise<void>;
  /** Two taps on one spot, sent together so a slow script cannot stretch them past the page's double-tap window. */
  doubleTap(x: number, y: number): Promise<void>;
  drag(from: Pt, to: Pt, steps?: number): Promise<void>;
  hold(at: Pt, ms?: number): Promise<void>;
  /** Two fingers apart by `from` pixels, moved to `to` apart, about a centre. */
  pinch(centre: Pt, from: number, to: number): Promise<void>;
}

function makeFinger(page: Page, cdp: CDPSession | null): Finger {
  if (cdp) {
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id: id + 1 })),
      });
    return {
      async tap(x, y) {
        await send('touchStart', [[x, y]]);
        await sleep(50);
        await send('touchEnd', []);
        await sleep(300);
      },
      async doubleTap(x, y) {
        // Queued without an await between them: the protocol keeps their order, and nothing here can stall between the taps.
        await Promise.all([
          send('touchStart', [[x, y]]),
          send('touchEnd', []),
          send('touchStart', [[x, y]]),
          send('touchEnd', []),
        ]);
        await sleep(300);
      },
      async drag(from, to, steps = 12) {
        await send('touchStart', [from]);
        for (let i = 1; i <= steps; i++) {
          await send('touchMove', [
            [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps],
          ]);
          await sleep(20);
        }
        await send('touchEnd', []);
        await sleep(600);
      },
      async hold(at, ms = 800) {
        await send('touchStart', [at]);
        await sleep(ms);
        await send('touchEnd', []);
        await sleep(300);
      },
      async pinch([cx, cy], from, to) {
        const at = (d: number): Pt[] => [
          [cx - d / 2, cy],
          [cx + d / 2, cy],
        ];
        await send('touchStart', at(from));
        for (let i = 1; i <= 12; i++) {
          await send('touchMove', at(from + ((to - from) * i) / 12));
          await sleep(20);
        }
        await send('touchEnd', []);
        await sleep(600);
      },
    };
  }
  // WebKit: one script in the page, with the time kept by the page.
  const run = (script: string, arg: unknown) =>
    page.evaluate(`(async () => { const arg = ${JSON.stringify(arg)}; ${script} })()`);
  const PRELUDE = `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The element under the finger gets every event, as the game releases a touch's capture where it presses (drag.ts).
    const fire = (type, id, x, y) => {
      const el = document.elementFromPoint(x, y) ?? document.body;
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    };`;
  return {
    async tap(x, y) {
      await page.touchscreen.tap(x, y);
      await sleep(300);
    },
    async doubleTap(x, y) {
      // Both taps in one script in the page, so the time between them is the page's own.
      await run(
        PRELUDE +
          `const [x, y] = arg;
          fire('pointerdown', 1, x, y); await sleep(30); fire('pointerup', 1, x, y);
          await sleep(60);
          fire('pointerdown', 1, x, y); await sleep(30); fire('pointerup', 1, x, y);`,
        [x, y],
      );
      await sleep(300);
    },
    async drag(from, to, steps = 12) {
      await run(
        PRELUDE +
          `const [from, to, steps] = arg;
          fire('pointerdown', 1, from[0], from[1]);
          for (let i = 1; i <= steps; i++) {
            fire('pointermove', 1, from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
            await sleep(20);
          }
          fire('pointerup', 1, to[0], to[1]);`,
        [from, to, steps],
      );
      await sleep(600);
    },
    async hold(at, ms = 800) {
      await run(
        PRELUDE +
          `const [at, ms] = arg;
          fire('pointerdown', 1, at[0], at[1]);
          await sleep(ms);
          fire('pointerup', 1, at[0], at[1]);`,
        [at, ms],
      );
      await sleep(300);
    },
    async pinch([cx, cy], from, to) {
      await run(
        PRELUDE +
          `const [cx, cy, from, to] = arg;
          const at = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]];
          const move = (type, d) => at(d).forEach(([x, y], i) => fire(type, i + 1, x, y));
          move('pointerdown', from);
          for (let i = 1; i <= 12; i++) { move('pointermove', from + (to - from) * i / 12); await sleep(20); }
          move('pointerup', to);`,
        [cx, cy, from, to],
      );
      await sleep(600);
    },
  };
}

/** What a script keeps of the Engine's maps and which windows stay open; call before page.goto. */
async function watchMaps(page: Page) {
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
}

/**
 * What the page starts with: the debug side panel hidden, as a player has it (a game with it shown has no order bar),
 * and the phone notice put away unless the script means to tap it. Call before page.goto.
 */
const prepare = (page: Page, { side = false, notice = false } = {}) =>
  page.addInitScript(
    ([showSide, showNotice]) => {
      try {
        localStorage.setItem('freecol.sidePanel', showSide ? 'shown' : 'hidden');
        if (!showNotice) sessionStorage.setItem('browsercol.mobileNoticeDismissed', '1');
      } catch {
        // storage blocked
      }
    },
    [side, notice] as const,
  );

const view = (page: Page) =>
  page.evaluate(() => {
    const v = window.fcView!() as unknown as {
      centre: [number, number];
      zoom: number;
      tapped: [number, number] | null;
      preview: unknown[] | null;
      active: { unit: string; tile: [number, number] | null } | null;
    };
    return v;
  });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(shotDir, `${label.replace(/ /g, '-')}-${name}.png`) });

/** What the page has at a point, for a failure message. */
const describeAt = (page: Page, [x, y]: Pt) =>
  page.evaluate(
    ([a, b]) => {
      const e = document.elementFromPoint(a!, b!);
      return e
        ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').join('.') : ''}`
        : 'nothing';
    },
    [x, y],
  );

/** Throws unless what the page has at the point is inside the element `inside` matches: a tap there would hit it. */
async function assertHit(page: Page, at: Pt, inside: string, what: string) {
  const ok = await page.evaluate(
    ([x, y, sel]) => !!document.elementFromPoint(x as number, y as number)?.closest(sel as string),
    [at[0], at[1], inside],
  );
  if (!ok)
    throw new Error(
      `a tap at ${at.map(Math.round).join(',')} for ${what} would hit ${await describeAt(page, at)}, not ${inside}`,
    );
}

/**
 * The middle of an element, once it is there and scrolled into view as a player would; throws if something else
 * is on top of that point even then.
 */
const center = async (l: Locator): Promise<Pt> => {
  const e = l.first();
  await e.waitFor({ state: 'visible', timeout: 20000 });
  await e.scrollIntoViewIfNeeded();
  // A sheet scrolls and its content settles as images arrive: aim at the box once it has stopped moving.
  let b = (await e.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    const now = (await e.boundingBox())!;
    const still = now.x === b.x && now.y === b.y && now.width === b.width && now.height === b.height;
    b = now;
    if (still) break;
  }
  const at: Pt = [b.x + b.width / 2, b.y + b.height / 2];
  const ok = await e.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x!, y!)), at);
  if (!ok)
    throw new Error(
      `the middle of ${String(l)} at ${at.map(Math.round).join(',')} is covered by ${await describeAt(l.page(), at)}`,
    );
  return at;
};

/** A point on the map canvas: throws if the order bar, a panel or a window is over it. */
async function onMap(page: Page, at: Pt, what: string): Promise<Pt> {
  await assertHit(page, at, '#map canvas', what);
  return at;
}

/** Waits for a condition that reads the page from here, up to `ms`; polls, so a slow page only takes longer. */
async function until(fn: () => Promise<boolean>, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

/** Runs one part of a part, so that a miss is reported and the next one still runs on what the page has. */
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (ex) {
    check(name, false, await diagnose(ex));
  }
}

/** Waits for a condition the page decides, for as long as `ms`; false when it did not come. */
const soon = async (page: Page, fn: () => boolean, ms = 5000) =>
  page.waitForFunction(fn, null, { timeout: ms }).then(
    () => true,
    () => false,
  );

/** Where tile (x, y) is on the page: the view moves to show it when it has to. */
async function tileAt(page: Page, x: number, y: number): Promise<Pt> {
  const box = (await page.locator('#map canvas').boundingBox())!;
  const [px, py] = await page.evaluate(([a, b]) => window.fcReveal!(a, b), [x, y]);
  return onMap(page, [box.x + px, box.y + py], `tile ${x},${y}`);
}

/** Candidate tiles around a tile, nearest first, for a destination the active unit can reach. */
const around = ([x, y]: [number, number]): [number, number][] => {
  const out: [number, number, number][] = [];
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -4; dy <= 4; dy++) if (dx || dy) out.push([x + dx, y + dy, Math.abs(dx) * 2 + Math.abs(dy)]);
  return out.sort((a, b) => a[2] - b[2]).map(([a, b]) => [a, b]);
};

async function waitForTurn(page: Page) {
  await page.waitForFunction(() => window.__map?.ourTurn && window.__map.active, null, { timeout: timeout });
  await sleep(1500);
}

/** The page's settled, our-turn state of a preset game that stays on our turn. */
async function openPreset(page: Page, query: string) {
  await page.goto(`${server.url}?${query}`);
  const r = await waitForResult(page, timeout);
  if (r.status !== 'finished') throw new Error(`no game: ${JSON.stringify(r)}`);
}

/** The start screen by taps: a nation is picked, the game starts and is the player's. */
async function startByTaps(page: Page, finger: Finger, nation: string) {
  await page.waitForSelector('[data-start]', { timeout: 60000 });
  await finger.tap(...(await center(page.locator(`label.nation:has([data-nation="${nation}"])`))));
  check('a tap on a nation picks it', await until(() => page.locator(`[data-nation="${nation}"]`).isChecked()));
  await page.locator('[data-start]').scrollIntoViewIfNeeded();
  await finger.tap(...(await center(page.locator('[data-start]'))));
  const r = await waitForResult(page, timeout);
  check(
    'the game starts from the start screen',
    r.status === 'finished' && r.nation === nation,
    `${r.status} ${r.nation}`,
  );
}

/** The page's layout fits the device: its width is the viewport's, with nothing wider. */
async function checkLayout(page: Page, width: number) {
  const m = await page.evaluate(() => ({
    inner: innerWidth,
    scroll: document.documentElement.scrollWidth,
    scale: visualViewport?.scale ?? 1,
  }));
  check(
    'the layout is as wide as the device',
    m.inner === width && m.scroll <= width && m.scale === 1,
    JSON.stringify(m),
  );
}

const noticeShown = (page: Page) =>
  page.evaluate(() => {
    const n = document.getElementById('rotate-notice');
    return !!n && getComputedStyle(n).display !== 'none';
  });

/** The order bar's three touch buttons, and Go to by taps with the path shown first. */
async function orderBar(page: Page, finger: Finger) {
  const bar = page.locator('#map-orders');
  await bar.waitFor({ timeout: 20000 });
  for (const [order, text] of [
    ['nextUnit', 'Wait'],
    ['selectDestination', 'Go to'],
    ['change', 'Next unit on tile'],
  ] as const)
    check(`the order bar has ${text}`, (await bar.locator(`[data-order=${order}]`).count()) === 1);
  await shot(page, 'map-orders');
  const after = await view(page);
  if (!after.active?.tile) return;
  // Go to: the button is pressed, a tap on a reachable tile shows the path, the same tap again sends the unit.
  const goButton = bar.locator('[data-order=selectDestination]');
  await finger.tap(...(await center(goButton)));
  check(
    'Go to is pressed while choosing',
    await until(async () => (await goButton.getAttribute('aria-pressed')) === 'true'),
  );
  let chosen: [number, number] | null = null;
  for (const t of around(after.active.tile)) {
    await finger.tap(...(await tileAt(page, ...t)));
    // A tile the unit cannot reach shows no path; the wait for one is short for those.
    if (await soon(page, () => (window.fcView!().preview?.length ?? 0) > 0, 2500)) {
      chosen = t;
      break;
    }
  }
  check('a tap on a tile shows the path there', chosen !== null);
  if (!chosen) return;
  await shot(page, 'goto-preview');
  const was = after.active;
  await finger.tap(...(await tileAt(page, ...chosen)));
  const gone = await soon(
    page,
    () => !document.querySelector('[data-order=selectDestination][aria-pressed=true]') && !window.fcView!().preview,
  );
  const moved = await until(async () => {
    const a = (await view(page)).active;
    return a?.unit !== was.unit || a?.tile?.join() !== was.tile?.join();
  }, 20000);
  const now = await view(page);
  check(
    'a second tap on it sends the unit',
    gone && moved,
    `${was.unit}@${was.tile?.join()} -> ${now.active?.unit}@${now.active?.tile?.join()}`,
  );
}

/** The map's gestures, on a game with a colony. Each gesture is its own step on whatever state the one before left. */
async function mapGestures(page: Page, finger: Finger, colony: [number, number]) {
  const box = (await page.locator('#map canvas').boundingBox())!;
  const menu = page.locator('[role=menu].popup');
  const popupGone = () => until(async () => (await menu.count()) === 0);
  // Tap: the tile's name fills the info panel (view.tapped), whatever it is.
  await step('a tap picks the tile for the info panel', async () => {
    const next: [number, number] = around(colony)[0]!;
    await finger.tap(...(await tileAt(page, ...next)));
    const picked = await until(async () => (await view(page)).tapped?.join() === next.join(), 15000);
    check('a tap picks the tile for the info panel', picked, `${(await view(page)).tapped?.join()} for ${next.join()}`);
  });
  // Pan: one finger drags the map under it.
  await step('a finger drag pans the view', async () => {
    const from = await onMap(page, [box.x + box.width * 0.35, box.y + box.height * 0.35], 'the drag start');
    const c0 = (await view(page)).centre;
    await finger.drag(from, [from[0] - 140, from[1] - 50]);
    const dist = async () => {
      const c = (await view(page)).centre;
      return Math.hypot(c[0] - c0[0], c[1] - c0[1]);
    };
    await until(async () => (await dist()) > 20);
    const c1 = (await view(page)).centre;
    check(
      'a finger drag pans the view',
      Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 20,
      `${c0.map(Math.round).join()} -> ${c1.map(Math.round).join()}`,
    );
  });
  // Pinch: spread two fingers and the zoom changes, then snaps to a level; pinch together to go back.
  await step('a pinch changes the zoom', async () => {
    const mid = await onMap(page, [box.x + box.width / 2, box.y + box.height / 2], 'the pinch centre');
    const zoom = async () => (await view(page)).zoom;
    const z0 = await zoom();
    const out = z0 >= 1 ? 30 : 140;
    await finger.pinch(mid, 60, out);
    await until(async () => (await zoom()) !== z0 && ZOOMS.includes(await zoom()));
    const z1 = await zoom();
    check('a pinch changes the zoom and snaps to a level', z1 !== z0 && ZOOMS.includes(z1), `${z0} -> ${z1}`);
    await finger.pinch(mid, out, 60);
    await until(async () => (await zoom()) !== z1 && ZOOMS.includes(await zoom()));
    const z2 = await zoom();
    check('a pinch back snaps to a level too', ZOOMS.includes(z2), `${z2}`);
  });
  // Long press on a tile: its popup.
  await step('a long press opens the tile popup', async () => {
    await finger.hold(await tileAt(page, ...colony), 800);
    check('a long press opens the tile popup', await until(() => menu.first().isVisible()));
    await shot(page, 'longpress-popup');
    await finger.tap(...(await onMap(page, [box.x + 5, box.y + box.height / 2], 'a spot away from the popup')));
    check('a tap elsewhere closes the popup', await popupGone());
  });
  // Double tap on the colony: its window. The step before leaves nothing open (a popup is closed here if it stayed).
  await step('a double-tap on a colony opens it', async () => {
    if ((await menu.count()) > 0) {
      await page.keyboard.press('Escape');
      await popupGone();
    }
    await page.evaluate(() => (window.__hold = 'colony'));
    const win = page.locator('[role=dialog][data-kind=colony]');
    const opened = async (ms: number) =>
      win
        .first()
        .waitFor({ timeout: ms })
        .then(
          () => true,
          () => false,
        );
    await finger.doubleTap(...(await tileAt(page, ...colony)));
    const ok = await opened(20000);
    check('a double-tap on a colony opens it', ok);
    // The colony part needs the window; one more try (not checked) so a miss above does not take it down too.
    if (!ok) {
      await finger.doubleTap(...(await tileAt(page, ...colony)));
      await opened(20000);
    }
  });
}

/** Wait: the next unit is active (the preset has several). */
async function waitButton(page: Page, finger: Finger) {
  const before = await view(page);
  await finger.tap(...(await center(page.locator('#map-orders [data-order=nextUnit]'))));
  await until(async () => (await view(page)).active?.unit !== before.active?.unit, 20000);
  const after = await view(page);
  check(
    'Wait moves to the next unit',
    !!after.active && before.active?.unit !== after.active.unit,
    `${before.active?.unit} -> ${after.active?.unit}`,
  );
}

/** A game with several units to move, for Wait. */
async function waitGame(browser: Browser, device: TouchDevice, finger: (page: Page) => Promise<Finger>) {
  const page = await newTouchPage(browser, device);
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  await watchMaps(page);
  await prepare(page);
  try {
    await openPreset(page, 'skipstart&preset=combat');
    await waitForTurn(page);
    await waitButton(page, await finger(page));
  } catch (ex) {
    check('wait', false, await diagnose(ex));
    await shot(page, 'error-wait').catch(() => {});
  }
  if (errors.length) check('no page errors', false, errors.join(' | '));
  await page.context().close();
}

/** Checks that a window is a full-screen sheet with its top bar and back button on the screen (common.ts, sheetProblems). */
async function isSheet(page: Page, selector: string, what: string) {
  const bad = await page.evaluate(sheetProblems, selector).catch((ex) => [String(ex).split('\n')[0]!]);
  check(`${what} is a sheet`, bad.length === 0, bad.join('; '));
}

/**
 * A window opened from the menu bar is a sheet, and its back button closes it. The Report menu's first entry; the
 * titles are what the menu bar shows on this screen.
 */
async function menuSheet(page: Page, finger: Finger) {
  const dialogs = page.locator('[role=dialog]');
  const before = await dialogs.count();
  await step('a window opened from the menu is a sheet', async () => {
    const title = page.locator('.menubar [role=menubar] > .menu > button', { hasText: 'Report' }).first();
    await finger.tap(...(await center(title)));
    const entry = page.locator('[role=menu][aria-label="Report"] [role=menuitem]:not([disabled])').first();
    await finger.tap(...(await center(entry)));
    check('a menu entry opens a window', await until(async () => (await dialogs.count()) > before));
    await isSheet(page, '[role=dialog]', 'a window opened from the menu');
    await shot(page, 'sheet-report');
    await finger.tap(...(await center(dialogs.last().locator('.title .close'))));
    check('its back button closes it', await until(async () => (await dialogs.count()) === before));
  });
}

/** A short prompt stays a centred modal on a phone: the Disband order's question is not a sheet, and No answers it. */
async function confirmModal(page: Page, finger: Finger) {
  await step('a confirm dialog stays a centred modal', async () => {
    const win = page.locator('[role=dialog][data-kind=confirm]');
    await finger.tap(...(await center(page.locator('#map-orders [data-order=disband]:not([disabled])'))));
    await win.waitFor({ timeout: 10000 });
    const r = await win.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      return { sheet: el.hasAttribute('data-sheet'), gapX: b.left, gapY: b.top, w: b.width, h: b.height, vw, vh };
    });
    check(
      'a confirm dialog is a centred modal, not a sheet',
      !r.sheet && r.w < r.vw - 40 && r.h <= r.vh && r.gapX > 0 && Math.abs(r.gapX - (r.vw - r.w - r.gapX)) < 2,
      JSON.stringify(r),
    );
    await shot(page, 'modal-confirm');
    await finger.tap(...(await center(win.locator('[data-answer=cancel]'))));
    check('No answers it', await until(async () => (await win.count()) === 0));
  });
}

/** Menu bar and tips: a tap opens and switches a menu, a long press shows a tip, a tap elsewhere closes it. */
async function bars(page: Page, finger: Finger) {
  const titles = page.locator('.menubar [role=menubar] > .menu > button');
  const n = await titles.count();
  const open = (label: string | null) => page.locator(`[role=menu][aria-label="${label}"]`).count();
  const any = () => page.locator('.menubar [role=menu]').count();
  const second = Math.min(1, n - 1);
  const first = await titles.nth(0).textContent();
  const next = await titles.nth(second).textContent();
  await step('a tap on a menu title opens its menu', async () => {
    if ((await any()) > 0) await finger.tap(...(await center(titles.nth(0)))); // a menu left open
    await until(async () => (await any()) === 0);
    await finger.tap(...(await center(titles.nth(0))));
    check('a tap on a menu title opens its menu', await until(async () => (await open(first)) === 1));
  });
  await step('a tap on another title switches menus', async () => {
    await finger.tap(...(await center(titles.nth(second))));
    check(
      'a tap on another title switches menus',
      await until(async () => (await open(next)) === 1 && (second === 0 || (await open(first)) === 0)),
    );
  });
  await step('a tap on the open title closes it', async () => {
    await finger.tap(...(await center(titles.nth(second))));
    check('a tap on the open title closes it', await until(async () => (await any()) === 0));
  });
  // A Tip trigger: the order bar's Wait.
  const tip = page.locator('.ui-tip');
  const shown = () => tip.first().isVisible();
  await step('a long press on a Tip shows its tooltip', async () => {
    await finger.hold(await center(page.locator('#map-orders [data-order=nextUnit]')), 800);
    check('a long press on a Tip shows its tooltip', await until(shown));
  });
  await step('a tap elsewhere closes the tooltip', async () => {
    const map = (await page.locator('#map canvas').boundingBox())!;
    await finger.tap(...(await onMap(page, [map.x + 5, map.y + map.height / 2], 'a spot away from the tooltip')));
    check('a tap elsewhere closes the tooltip', await until(async () => (await tip.count()) === 0 || !(await shown())));
  });
}

/** The colony window: a long press, a finger drag, two taps and Escape. Each is a step on the colonist's place now. */
async function colony(page: Page, finger: Finger) {
  const win = page.locator('[role=dialog][data-kind=colony]');
  await win.first().waitFor({ timeout: 30000 });
  await isSheet(page, '[role=dialog][data-kind=colony]', 'the colony');
  await shot(page, 'sheet-colony');
  await page.locator('.colony [data-unit]').first().waitFor({ timeout: 30000 });
  const units = await page
    .locator('.colony [data-unit]')
    .evaluateAll((es) => es.map((e) => (e as HTMLElement).dataset.unit!));
  const buildings = await page
    .locator('.colony [data-building]')
    .evaluateAll((es) => es.map((e) => e.getAttribute('data-building')!));
  const where = (id: string) =>
    page.evaluate((id) => {
      const e = document.querySelector(`.colony [data-unit="${id}"]`);
      if (!e) return 'gone';
      const t = e.closest<HTMLElement>('[data-tile]');
      if (t) return `tile ${t.dataset.tile}`;
      const b = e.closest('[data-building]');
      return b
        ? `building ${b.getAttribute('data-building')}`
        : (e.closest<HTMLElement>('[data-part]')?.dataset.part ?? '?');
    }, id);
  const sel = (id: string) => page.locator(`.colony [data-unit="${id}"]`);
  const id = units[0]!;
  const picked = () => page.locator('[data-picked]').count();
  const menu = page.locator('[role=menu].popup');
  const tgt = (b: string) => page.locator(`.colony [data-building="${b}"]`);
  check('the colony has colonists and buildings', units.length > 0 && buildings.length > 1);
  /** A pick or popup left by a step that missed is put down, so the next step starts clean. */
  const clean = async () => {
    if ((await picked()) > 0 || (await menu.count()) > 0) {
      await page.keyboard.press('Escape');
      await until(async () => (await picked()) === 0 && (await menu.count()) === 0, 5000);
    }
  };
  // Long press on a colonist: its menu.
  await step('a long press on a colonist opens its menu', async () => {
    await sel(id).scrollIntoViewIfNeeded();
    await finger.hold(await center(sel(id)), 800);
    const opened = await until(() => menu.first().isVisible());
    const seen = opened
      ? ''
      : `menus ${await menu.count()}, ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role=menu]')].map((m) => m.getBoundingClientRect().toJSON())))}`;
    if (!opened) await shot(page, 'colony-longpress-fail');
    check('a long press on a colonist opens its menu', opened, seen);
    await finger.tap(...(await center(win.locator('.title'))));
    check('a tap elsewhere closes it', await until(async () => (await menu.count()) === 0));
  });
  // Finger drag onto a building.
  await step('a finger drag moves a colonist onto a building', async () => {
    await clean();
    const start = await where(id);
    const target = buildings.find((b) => start !== `building ${b}`)!;
    await tgt(target).scrollIntoViewIfNeeded();
    await finger.drag(await center(sel(id)), await center(tgt(target)));
    await until(async () => (await where(id)) === `building ${target}`);
    const moved = await where(id);
    check('a finger drag moves a colonist onto a building', moved === `building ${target}`, `${start} -> ${moved}`);
  });
  // Tap then tap.
  await step('a tap picks the colonist', async () => {
    await clean();
    await sel(id).scrollIntoViewIfNeeded();
    await finger.tap(...(await center(sel(id))));
    check('a tap picks the colonist', await until(async () => (await picked()) === 1));
    await shot(page, 'colony-picked');
  });
  await step('a tap on a building puts it there', async () => {
    const now = await where(id);
    const target2 = buildings.find((b) => `building ${b}` !== now)!;
    if ((await picked()) === 0) {
      await sel(id).scrollIntoViewIfNeeded();
      await finger.tap(...(await center(sel(id)))); // not picked by the step before
      await until(async () => (await picked()) === 1);
    }
    await tgt(target2).scrollIntoViewIfNeeded();
    await finger.tap(...(await center(tgt(target2))));
    await until(async () => (await where(id)) === `building ${target2}` && (await picked()) === 0);
    const moved2 = await where(id);
    check(
      'a tap on a building puts it there',
      moved2 === `building ${target2}` && (await picked()) === 0,
      `${now} -> ${moved2}`,
    );
  });
  // Escape cancels a pick, the window stays.
  await step('Escape puts a pick down and closes no window', async () => {
    await clean();
    await sel(id).scrollIntoViewIfNeeded();
    await finger.tap(...(await center(sel(id))));
    await until(async () => (await picked()) === 1);
    await page.keyboard.press('Escape');
    check(
      'Escape puts a pick down and closes no window',
      await until(async () => (await picked()) === 0 && (await win.count()) === 1),
    );
  });
  await finger.tap(...(await center(win.locator('button.close, .close').first())));
  await until(async () => (await win.count()) === 0, 5000);
}

/** Europe: a cargo unit goes to the docks by two taps. */
async function europe(page: Page, finger: Finger) {
  const SHIPS = [
    'model.unit.caravel',
    'model.unit.frigate',
    'model.unit.galleon',
    'model.unit.merchantman',
    'model.unit.privateer',
  ];
  const gold = () => page.$eval('#statusLine', (e) => Number(/Gold: (\d+)/.exec(e.textContent!)?.[1]));
  const purse = await gold();
  await page.fill('input[aria-label="Gold"]', '5000');
  await page.click('button[data-debug="gold"]');
  await page.waitForFunction(
    (g) => Number(/Gold: (\d+)/.exec(document.querySelector('#statusLine')!.textContent!)?.[1]) === g,
    purse + 5000,
    { timeout: 60_000 },
  );
  await page.evaluate(() => (window.__hold = 'europe'));
  await page.click('button[data-command=showEurope]');
  const panel = page.locator('[role=dialog][data-kind=europe]');
  await panel.waitFor({ timeout: 10_000 });
  await isSheet(page, '[role=dialog][data-kind=europe]', 'Europe');
  await panel.locator('button[data-europe=purchase]').click();
  // The purchase list is a window opened from Europe: a sheet over it, and back returns to Europe.
  await panel.locator('[data-shop=purchase]').waitFor({ timeout: 10_000 });
  await isSheet(page, '[data-shop=purchase]', 'the purchase list opened from Europe');
  check('Europe stays under it', (await page.locator('[role=dialog][data-sheet]').count()) === 2);
  await shot(page, 'sheet-stacked');
  await finger.tap(...(await center(panel.locator('[data-shop=purchase] .title .close'))));
  check(
    'its back button returns to Europe',
    await until(async () => (await panel.locator('[data-shop]').count()) === 0 && (await panel.isVisible())),
  );
  await isSheet(page, '[role=dialog][data-kind=europe]', 'Europe after back');
  await panel.locator('button[data-europe=purchase]').click();
  const offers = panel.locator('[data-shop=purchase] [data-offer]');
  for (let i = 0, n = await offers.count(); i < n; i++) {
    if (SHIPS.includes((await offers.nth(i).getAttribute('data-offer'))!)) {
      await offers.nth(i).click();
      break;
    }
  }
  await panel.locator('[data-list=inPort] [data-unit]').first().waitFor({ timeout: 60_000 });
  const shop = panel.locator('[data-shop]');
  if ((await shop.count()) > 0) await shop.locator('button.close').click();
  await shop.waitFor({ state: 'detached', timeout: 10_000 });
  await panel.locator('button[data-europe=recruit]').click();
  const rec = panel.locator('[data-shop=recruit] [data-recruit]');
  await rec.first().waitFor({ timeout: 10_000 });
  await rec.first().click();
  await sleep(1000);
  if ((await panel.locator('[data-shop]').count()) > 0)
    await panel
      .locator('[data-shop] button.close')
      .click()
      .catch(() => {});
  await panel.locator('[data-list=docks] [data-unit]').first().waitFor({ timeout: 20_000 });
  // A tap on a docks unit boards it (its click is kept).
  await finger.tap(...(await center(panel.locator('[data-list=docks] [data-unit]'))));
  const aboard = await soon(
    page,
    () => document.querySelectorAll('[data-list=cargo] [data-cargo=unit]').length === 1,
    10000,
  );
  check('a tap on a colonist on the docks boards the ship', aboard);
  await panel.locator('[data-list=cargo] [data-cargo=unit]').scrollIntoViewIfNeeded();
  // Tap the cargo unit: picked; tap the docks: landed.
  await finger.tap(...(await center(panel.locator('[data-list=cargo] [data-cargo=unit]'))));
  check('a tap on a cargo unit picks it', await until(async () => (await page.locator('[data-picked]').count()) === 1));
  await shot(page, 'europe-picked');
  await finger.tap(...(await center(panel.locator('[data-list=docks]'))));
  const landed = await soon(
    page,
    () =>
      document.querySelectorAll('[data-list=docks] [data-unit]').length === 1 &&
      document.querySelectorAll('[data-list=cargo] [data-cargo=unit]').length === 0,
    10000,
  );
  check('a tap on the docks lands the cargo unit', landed);
}

/** A hidden page in our turn saves to the background slot; a fresh start screen offers to resume it. */
async function background(page: Page, finger: Finger) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const names = async () =>
    page.evaluate(
      () =>
        new Promise<string[]>((ok) => {
          const r = indexedDB.open('freecol-saves');
          r.onerror = () => ok([]);
          r.onsuccess = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('saves')) return ok([]);
            const all = db.transaction('saves').objectStore('saves').getAll();
            all.onsuccess = () => ok((all.result as { name: string }[]).map((m) => m.name));
            all.onerror = () => ok([]);
          };
        }),
    );
  let found: string[] = [];
  for (let i = 0; i < 60 && !found.includes('Background autosave'); i++) {
    await sleep(500);
    found = await names();
  }
  check('a hidden page saves a Background autosave', found.includes('Background autosave'), found.join(', '));
  await page.goto(`${server.url}?autoplay=0`);
  const text = await page
    .locator('[data-continue]')
    .textContent({ timeout: 30000 })
    .catch(() => null);
  check('the start screen offers to resume it', text === 'Resume your last game', String(text));
  void finger;
}

/** The mouse in a page with no touch screen: a held press starts a Go To, a right-click opens the popup. */
async function mouseUnchanged(browserName: BrowserName) {
  label = `${browserName} mouse`;
  const browser = await launchBrowser(browserName);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectPageErrors(page);
  await answerDialogs(page);
  await watchMaps(page);
  await prepare(page);
  try {
    await openPreset(page, 'skipstart&debug&preset=colony-step');
    await waitForTurn(page);
    await page.waitForFunction(() => window.__map.settlements.some((s) => s.population >= 0), null, { timeout: 60000 });
    const m = await page.evaluate(() => window.__map);
    const mine = m.settlements.filter((s) => s.population >= 0);
    const colonyAt: [number, number] = [mine[0]!.x, mine[0]!.y];
    const tile = (await view(page)).active?.tile;
    if (!tile) throw new Error('no active unit');
    // Right-click: the tile popup.
    const spot = await tileAt(page, ...colonyAt);
    await page.mouse.click(...spot, { button: 'right' });
    check(
      'a right-click opens the tile popup',
      await until(() => page.locator('[role=menu].popup').first().isVisible()),
    );
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('[role=menu].popup').count()) === 0);
    // Hold: the path shows while the button is down, and the unit is sent on release.
    let held = false;
    for (const t of around(tile)) {
      const p = await tileAt(page, ...t);
      await page.mouse.move(...p);
      await page.mouse.down();
      // The path shows once the press has been held (500 ms in the page); a tile the unit cannot reach shows none.
      const shown = await soon(page, () => (window.fcView!().preview?.length ?? 0) > 0, 3000);
      await page.mouse.up();
      if (shown) {
        held = true;
        break;
      }
      await sleep(300);
    }
    check('a held press shows the Go To path', held);
    check(
      'the order bar has no touch buttons',
      (await page.locator('#map-orders [data-order=selectDestination]').count()) === 0,
    );
  } catch (ex) {
    check('mouse run', false, await diagnose(ex));
  }
  if (errors.length) check('no page errors', false, errors.join(' | '));
  await browser.close();
}

const nation = 'model.nation.french';
const browsers = new Map<BrowserName, TouchDevice[]>();
for (const d of wanted) {
  const b = TOUCH_DEVICES[d].browser as BrowserName;
  if (only.includes(b)) browsers.set(b, [...(browsers.get(b) ?? []), d]);
}

for (const [browserName, devices] of browsers) {
  const browser = await launchBrowser(browserName);
  for (const device of devices) {
    const d = TOUCH_DEVICES[device];
    const full = device !== 'ipad';
    label = `${browserName} ${device}`;
    console.log(`--- ${label}: ${d.width}x${d.height}`);
    const started = Date.now();
    // Portrait: the rotate notice.
    {
      const page = await newTouchPage(browser, device, true);
      await prepare(page);
      await page.goto(`${server.url}?autoplay=0`);
      await page.waitForSelector('[data-start]', { timeout: 60000 });
      check('the rotate notice shows in portrait', await noticeShown(page));
      await page.screenshot({ path: path.join(shotDir, `${label.replace(/ /g, '-')}-rotate.png`) });
      await page.context().close();
    }
    if (parts.includes('start')) {
      // The start screen and a generated game: order bar, a turn, background save.
      const page = await newTouchPage(browser, device);
      const errors = collectPageErrors(page);
      await answerDialogs(page);
      await watchMaps(page);
      await prepare(page, { notice: true });
      const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
      const finger = makeFinger(page, cdp);
      try {
        await page.goto(`${server.url}?autoplay=0`);
        await page.waitForSelector('[data-start]', { timeout: 60000 });
        // A phone is told the game was not made for it; a tap puts the notice away. A tablet is not told.
        const phone = Math.min(d.width, d.height) <= 600;
        const notice = page.locator('#mobile-notice [data-dismiss]');
        check(`the phone notice ${phone ? 'shows' : 'does not show'}`, (await notice.count()) === (phone ? 1 : 0));
        if (phone) {
          await finger.tap(...(await center(notice)));
          check(
            'a tap on Continue anyway puts the notice away',
            await until(async () => (await page.locator('#mobile-notice').count()) === 0),
          );
        }
        check('the rotate notice is hidden in landscape', !(await noticeShown(page)));
        await checkLayout(page, d.width);
        await startByTaps(page, finger, nation);
        await waitForTurn(page);
        await orderBar(page, finger);
        if (!full) {
          // Play a turn: skip the units, press End Turn.
          const turn = await page.evaluate(() => window.__map.turn);
          for (let i = 0; i < 12 && !(await page.locator('.info-end button').count()); i++) {
            const skip = page.locator('#map-orders [data-order=skip]');
            if (!(await skip.count()) || (await skip.isDisabled())) break;
            const before = (await view(page)).active?.unit;
            await finger.tap(...(await center(skip)));
            await until(
              async () =>
                (await view(page)).active?.unit !== before || !!(await page.locator('.info-end button').count()),
              10000,
            );
          }
          await finger.tap(...(await center(page.locator('.info-end button'))));
          const passed = await page
            .waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 120000 })
            .then(
              () => true,
              () => false,
            );
          check('a turn is played by taps', passed);
        } else {
          await waitForTurn(page);
          await background(page, finger);
        }
      } catch (ex) {
        check('start and order bar', false, await diagnose(ex));
        await shot(page, 'error-start').catch(() => {});
      }
      if (errors.length) check('no page errors', false, errors.join(' | '));
      await page.context().close();
    }
    if (!full) {
      console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
      continue;
    }
    if (parts.includes('map')) {
      // A game with colonies: map gestures, bars, the colony window.
      const game = await newTouchPage(browser, device);
      const errors2 = collectPageErrors(game);
      await answerDialogs(game);
      await watchMaps(game);
      await prepare(game);
      const finger2 = makeFinger(game, browserName === 'chromium' ? await game.context().newCDPSession(game) : null);
      try {
        await openPreset(game, 'skipstart&debug&preset=colony-step');
        await game.waitForFunction(
          () => window.__map?.ourTurn && window.__map.settlements.filter((s) => s.population >= 0).length >= 3,
          null,
          { timeout: timeout, polling: 500 },
        );
        await sleep(3000);
        const m = await game.evaluate(() => window.__map);
        const mine = m.settlements.filter((s) => s.population >= 0);
        const colonyAt: [number, number] = [mine[0]!.x, mine[0]!.y];
        await mapGestures(game, finger2, colonyAt);
        await game.evaluate(() => (window.__hold = null));
        await colony(game, finger2).catch(async (ex) => {
          check('colony window', false, await diagnose(ex));
          await shot(game, 'error-colony').catch(() => {});
        });
        // answerDialogs would close a report and answer Yes to the Disband question: hold both open for the checks.
        await game.evaluate(() => (window.__hold = 'report,confirm'));
        await menuSheet(game, finger2);
        await confirmModal(game, finger2);
        await game.evaluate(() => (window.__hold = null));
        await bars(game, finger2);
      } catch (ex) {
        check('map gestures', false, await diagnose(ex));
        await shot(game, 'error-map').catch(() => {});
      }
      if (errors2.length) check('no page errors', false, errors2.join(' | '));
      await game.context().close();
    }
    if (parts.includes('map')) {
      await waitGame(browser, device, async (p) =>
        makeFinger(p, browserName === 'chromium' ? await p.context().newCDPSession(p) : null),
      );
    }
    if (parts.includes('europe')) {
      // Europe.
      const eu = await newTouchPage(browser, device);
      const errors3 = collectPageErrors(eu);
      await answerDialogs(eu);
      await prepare(eu, { side: true });
      const finger3 = makeFinger(eu, browserName === 'chromium' ? await eu.context().newCDPSession(eu) : null);
      try {
        await openPreset(eu, 'preset=dutch-small&debug&autoplay=0');
        await europe(eu, finger3);
      } catch (ex) {
        check('europe', false, await diagnose(ex));
        await shot(eu, 'error-europe').catch(() => {});
      }
      if (errors3.length) check('no page errors', false, errors3.join(' | '));
      await eu.context().close();
    }
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  await browser.close();
}
if (only.includes('chromium') && parts.includes('mouse')) await mouseUnchanged('chromium');
server.close();
console.log(failed ? 'FAILED' : 'all touch checks passed');
process.exit(failed ? 1 : 0);
