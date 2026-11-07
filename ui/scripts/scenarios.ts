// Plays the scenarios of #349 in the built site: a late game that is a desktop FreeCol save, a late game the
// AI made, a big empire for the UI's load, and combat. Each loads in every browser, plays its step, and saves
// screenshots in .cache/ (scenario-NAME-BROWSER-*.png); the dialogs each opens are shown to the screenshots too.
//   desktop-late-game  the maintainer's desktop save (Dutch, turn 173, 40x100), imported as ADR 0007 says a desktop
//                      save loads, then a few turns, timing the AI's rounds and the panels
//   ai-late-game       the save `rounds.ts --save` made at AI round 300, played the same way
//   big-empire         ?preset=big-empire: thirty full colonies, a fleet and a garrison; times the map, the colony and
//                      Europe panels, the reports and a save
//   combat             ?preset=combat: the army beside a French colony and a native village at war, and a privateer
//                      and a frigate beside a loaded French galleon; attacks until the army has had its fights
//   capture-goods, dump-cargo, native-demand, diplomacy, independence, victory (#349 part 5)
//                      each leads the player to a dialog no game reaches by itself, answers it, and checks the
//                      game went on; the dialog is shot open as .cache/dialog-shots/METHOD-BROWSER.png
// The saves are the Engine's fixtures (engine/src/test/resources/saves), which the Engine tests load too.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/scenarios.ts [--only desktop-late-game,combat] [--browsers chromium,firefox] [--turns 5]
// Exits non-zero unless every scenario plays in every browser. It prints the AI's round times.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import type { Locator, Page } from 'playwright-core';

const browsers = browserNames();
const turns = Number(opt('turns', '5'));
/** How long a turn may take to end before it counts as stuck, in ms (--stall SECONDS, default 25 minutes). */
const STALL_MS = Number(opt('stall', '1500')) * 1000;
const only = opt('only', '')
  .split(',')
  .filter((x) => x);
const root = path.resolve(import.meta.dirname, '../..');
const cache = path.join(root, '.cache');
const saves = path.join(root, 'engine/src/test/resources/saves');
fs.mkdirSync(cache, { recursive: true });

/** FreeCol's directions: the key that moves a unit that way, and the step from a tile (its row's parity matters). */
const DIRECTIONS: { key: string; odd: [number, number]; even: [number, number] }[] = [
  { key: 'ArrowUp', odd: [0, -2], even: [0, -2] },
  { key: 'PageUp', odd: [1, -1], even: [0, -1] },
  { key: 'ArrowRight', odd: [1, 0], even: [1, 0] },
  { key: 'PageDown', odd: [1, 1], even: [0, 1] },
  { key: 'ArrowDown', odd: [0, 2], even: [0, 2] },
  { key: 'End', odd: [0, 1], even: [-1, 1] },
  { key: 'ArrowLeft', odd: [-1, 0], even: [-1, 0] },
  { key: 'Home', odd: [0, -1], even: [-1, -1] },
];

const secs = (ms: number) => (ms / 1000).toFixed(2);

/** One scenario in one browser: the page, and what it logs. */
class Run {
  readonly page: Page;
  readonly scenario: string;
  readonly browser: string;
  readonly url: string;
  constructor(page: Page, scenario: string, browser: string, url: string) {
    this.page = page;
    this.scenario = scenario;
    this.browser = browser;
    this.url = url;
  }

  /** The screenshot's path: .cache/scenario-NAME-BROWSER-LABEL.png. */
  file(label: string) {
    return path.join(cache, `scenario-${this.scenario}-${this.browser}-${label}.png`);
  }
  shot = (label: string) => this.page.screenshot({ path: this.file(label) });
  note = (text: string) => console.log(`  [${this.scenario} / ${this.browser}] ${text}`);

  view = () => this.page.evaluate(() => window.__map);
  noDialog = () =>
    this.page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, {
      timeout: 120000,
      label: 'no dialog is open',
    });
  /**
   * Waits until no map has come for `ms`: the page has worked through what the server sent. Resolves with the
   * milliseconds it waited. Timing a panel before that times the page's backlog, not the panel (#353).
   */
  quiet = (ms: number, limit = 600000) =>
    this.page.evaluate(
      ([ms, limit]) =>
        new Promise<number>((done, fail) => {
          const start = performance.now();
          let last = window.__maps;
          let at = start;
          const timer = setInterval(() => {
            const now = performance.now();
            if (window.__maps !== last) {
              last = window.__maps;
              at = now;
            } else if (now - at >= ms) {
              clearInterval(timer);
              done(Math.round(now - start));
            } else if (now - start > limit) {
              clearInterval(timer);
              fail(new Error(`the page was not quiet after ${limit} ms`));
            }
          }, 100);
        }),
      [ms, limit] as [number, number],
    );
  /** Waits for the game to start or load, and the player's first turn. */
  finished = async (what: string) => {
    const r = await waitForResult(this.page, 900000);
    if (r.status !== 'finished') throw new Error(`${what}: the page did not start a game: ${JSON.stringify(r)}`);
    await this.page.waitForFunction(() => window.__map?.ourTurn, null, {
      timeout: 120000,
      label: `${what}: the first map view on the player's turn`,
    });
  };
  /** Ends the turn and waits for the next one of the human's; the AI's round time is in window.fcRounds. */
  endTurn = async () => {
    const turn = (await this.view()).turn;
    await this.noDialog();
    // The end turn dialogs asked so far: an Enter that was taken asks one (or ends the turn at once).
    const asked = () => this.page.evaluate(() => window.__dialogs.filter((d) => d.startsWith('endTurn')).length);
    const askedAtStart = await asked();
    await this.page.keyboard.press('Enter');
    // A long wait says what the page is doing every half minute: dialogs answered, AI rounds played, the status line.
    const t0 = Date.now();
    let presses = 0;
    let mapsBefore = -1;
    let noted = Date.now();
    for (;;) {
      const done = await this.page
        .waitForFunction((t: string) => window.__map.turn !== t && window.__map.ourTurn, turn, {
          timeout: 6000,
          label: 'the next turn starts and play is back with the human',
        })
        .then(() => true)
        .catch((ex: Error) => {
          if (!/Timeout/i.test(ex.message)) throw ex;
          return false;
        });
      if (done) break;
      // A late game has units waiting for orders and goto orders: the first Enter asks to end the turn
      // anyway and runs the orders, and the turn is back with the player, who must press Enter again.
      const idle = await this.page.evaluate(
        (maps: number) =>
          window.__maps === maps &&
          window.__map.ourTurn &&
          !window.__map.activeUnit &&
          !document.querySelector('[role=dialog]'),
        await this.page.evaluate(() => window.__maps),
      );
      // The page leaves an Enter alone while one of its dialogs is open, and a dialog the server asks as the turn
      // starts (the founding father to nominate) can be queued, though not yet on the page, when noDialog looks:
      // that Enter did nothing, and a player would press it again once the dialog is answered (#366).
      const mapsNow = await this.page.evaluate(() => window.__maps);
      const quiet = mapsNow === mapsBefore;
      mapsBefore = mapsNow;
      const ignored =
        quiet &&
        (await asked()) === askedAtStart &&
        (await this.page.evaluate(() => window.__map.ourTurn && !document.querySelector('[role=dialog]')));
      if (ignored && presses < 6) {
        presses++;
        this.note(`Enter was not taken (no end turn dialog asked, the page quiet): Enter again (${presses})`);
        await this.page.keyboard.press('Enter');
        continue;
      }
      if (idle && presses < 6) {
        presses++;
        this.note(`the turn is back with the player, no unit active: Enter again (${presses})`);
        await this.page.keyboard.press('Enter');
        continue;
      }
      if (Date.now() - noted < Math.min(30000, STALL_MS / 2)) continue;
      noted = Date.now();
      const state = await this.page.evaluate(() => ({
        dialogs: window.__dialogs.length,
        last: window.__dialogs.at(-1),
        rounds: (window.__aiMs ?? []).length,
        turn: window.__map.turn,
        ourTurn: window.__map.ourTurn,
        maps: window.__maps,
        status: document.querySelector('#turn')?.textContent,
        open: [...document.querySelectorAll('[role=dialog]')].map((d) => (d.textContent ?? '').slice(0, 120)),
      }));
      await this.shot(`waiting-${Math.round((Date.now() - t0) / 1000)}s`).catch(() => {});
      this.note(`still in turn ${turn} after ${secs(Date.now() - t0)} s: ${JSON.stringify(state)}`);
      if (Date.now() - t0 > STALL_MS) {
        await this.stuckDump(turn);
        throw new Error(`turn ${turn} did not end in ${secs(STALL_MS)} s`);
      }
    }
    return this.view();
  };
  /** What the page and the Engines were doing when a turn did not end, for the failure's report (#366). */
  stuckDump = async (turn: string) => {
    const state = await this.page
      .evaluate(() => ({
        map: { turn: window.__map.turn, ourTurn: window.__map.ourTurn, maps: window.__maps },
        active: window.__map.activeUnit,
        dialogs: window.__dialogs.slice(-8),
        errors: window.fcErrors,
        unasked: window.fcUnasked,
        open: [...document.querySelectorAll('[role=dialog]')].map((d) => d.outerHTML.slice(0, 400)),
        turnText: document.querySelector('#turn')?.textContent,
      }))
      .catch((ex: Error) => ({ dumpFailed: ex.message }));
    this.note(`STUCK in turn ${turn}: ${JSON.stringify(state)}`);
    this.note(
      `console tail:\n${this.consoleTail
        .filter((l) => !/Production type|random\(/.test(l))
        .slice(-40)
        .join('\n')}`,
    );
  };
  /** The last console lines of the page and its Workers. */
  consoleTail: string[] = [];
  /** The dialogs logged so far. */
  logged = () => this.page.evaluate(() => window.__dialogs.length);
  /** Milliseconds from `act` to the first dialog it opens whose log line starts with `prefix`. */
  async dialogTime(what: string, prefix: string, act: () => Promise<unknown>) {
    await this.noDialog();
    const before = await this.logged();
    const t0 = Date.now();
    await act();
    await this.page.waitForFunction(
      ([n, p]: [number, string]) => window.__dialogs.slice(n).some((d) => d.startsWith(p)),
      [before, prefix] as [number, string],
      { timeout: 60000, label: `${what}: a ${prefix} dialog opens` },
    );
    const ms = Date.now() - t0;
    this.note(`${what}: ${secs(ms)} s`);
    return ms;
  }
  /** The time the AI took each round so far (ms), from the player's end turn to its next turn (a played game has no "round" events). */
  rounds = () => this.page.evaluate(() => window.__aiMs ?? []);

  /** Plays turns, printing the AI's time for each round. */
  async playTurns(count: number) {
    const before = (await this.rounds()).length;
    for (let i = 1; i <= count; i++) {
      setStep(`${this.scenario}: turn ${i} of ${count}`);
      const t0 = Date.now();
      const m = await this.endTurn();
      this.note(`turn ${m.turn} (${m.turnLabel}): ${secs(Date.now() - t0)} s wall`);
    }
    const ms = (await this.rounds()).slice(before);
    this.note(
      `AI rounds (ms): ${ms.join(' ')}; mean ${Math.round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length))}`,
    );
    return ms;
  }

  /**
   * The foreign and native affairs reports (#354, #355) as a player opens them from the Report menu: each is held
   * open and shot into .cache/dialog-shots/ (at 1280x720, and the foreign one in a narrow window too), then checked.
   * The native report must list a tribe met, with a row for a settlement and its skill and trade; the foreign one
   * must fit its window with no scrolling.
   */
  /**
   * A screenshot for the maintainer's review, not a check: Firefox can take long over a tall one late in a game, so it
   * gets a long timeout, and a shot that still fails is noted, not a failure.
   */
  reviewShot = async (target: { screenshot: Page['screenshot'] }, file: string) => {
    await target.screenshot({ path: file, timeout: 120000 }).catch((ex: Error) => {
      this.note(`review screenshot ${path.basename(file)} not taken: ${ex.message.split('\n')[0]}`);
    });
  };
  async affairsReports(): Promise<void> {
    const page = this.page;
    setStep(`${this.scenario}: the affairs reports`);
    const dir = path.join(root, '.cache/dialog-shots');
    fs.mkdirSync(dir, { recursive: true });
    await this.noDialog();
    const open = async (item: string, kind: string): Promise<Locator> => {
      await page.evaluate((k) => (window.__hold = k), kind);
      await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
      await page.getByRole('menuitem', { name: new RegExp(`^${item}( (Ctrl\\+)?(Shift\\+)?F\\d+)?$`) }).click();
      const d = page.locator(`[role=dialog][data-kind="${kind}"]`);
      await d.waitFor({ timeout: 15000, label: `${item} opens` });
      return d;
    };
    const close = async (d: Locator) => {
      await d.locator('[data-answer=close]').first().click();
      await d.waitFor({ state: 'detached', timeout: 10000, label: 'the report closes' });
      await page.evaluate(() => (window.__hold = ''));
    };
    // A window is resized and given two frames to lay out before it is shot (Firefox's shot once waited for fonts for ever).
    const resize = async (size: { width: number; height: number }) => {
      await page.setViewportSize(size);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    const spills = (d: Locator) =>
      d.evaluate((el) => {
        const spill = (e: Element) => ({ h: e.scrollHeight - e.clientHeight, w: e.scrollWidth - e.clientWidth });
        const r = spill(el.querySelector('.report')!);
        const w = spill(el);
        return { h: Math.max(r.h, w.h), w: Math.max(r.w, w.w) };
      });
    await resize({ width: 1280, height: 720 });
    // The foreign affairs report: every nation's measures, in a window of 1280x720 and a narrow one.
    let d = await open('Foreign affairs report', 'report');
    await d
      .locator('thead th[data-nation]')
      .first()
      .waitFor({ timeout: 10000, label: 'the foreign report lists a nation' });
    const nations = await d.locator('thead th[data-nation]').count();
    setStep(`${this.scenario}: shot of the foreign report at 1280x720`);
    await this.reviewShot(page, path.join(dir, `foreign-affairs-late-game-${this.browser}.png`));
    const wide = await spills(d);
    await resize({ width: 640, height: 720 });
    setStep(`${this.scenario}: shot of the foreign report at 640x720`);
    await this.reviewShot(page, path.join(dir, `foreign-affairs-late-game-narrow-${this.browser}.png`));
    const narrow = await spills(d);
    await close(d);
    await resize({ width: 1280, height: 720 });
    this.note(
      `foreign affairs: ${nations} nations; spill at 1280x720 ${JSON.stringify(wide)}, at 640x720 ${JSON.stringify(narrow)}`,
    );
    // The native affairs report: not empty in a game that has met the natives.
    d = await open('Native affairs report', 'report');
    await d
      .locator('[data-tribe]')
      .first()
      .waitFor({ timeout: 10000, label: 'the native report lists a tribe' })
      .catch(() => {});
    await resize({ width: 1280, height: 1800 });
    // The whole report is shot: the window is let grow to its content first, so nothing is scrolled out of the shot.
    await d.evaluate((el) => {
      const dialog = el as HTMLElement;
      dialog.style.maxHeight = 'none';
      for (const e of dialog.querySelectorAll<HTMLElement>('.report')) {
        e.style.maxHeight = 'none';
        e.style.overflow = 'visible';
      }
    });
    setStep(`${this.scenario}: shot of the native report`);
    await this.reviewShot(d, path.join(dir, `native-affairs-late-game-${this.browser}.png`));
    await d.evaluate((el) => {
      const dialog = el as HTMLElement;
      dialog.style.maxHeight = '';
      for (const e of dialog.querySelectorAll<HTMLElement>('.report')) {
        e.style.maxHeight = '';
        e.style.overflow = '';
      }
    });
    const count = (sel: string) => d.locator(sel).count();
    const tribes = await count('[data-tribe]');
    const rows = await count('[data-settlement]');
    const skills = await count('[data-cell=skill] img, [data-cell=skill] span');
    const wanted = await count('[data-cell=wanted] img, [data-cell=wanted] span');
    const missions = await count('[data-cell=mission] img');
    await close(d);
    await resize({ width: 1280, height: 800 });
    this.note(
      `native affairs: ${tribes} tribes, ${rows} settlements, ${skills} skills, ${wanted} trade items, ${missions} missions`,
    );
    if (tribes === 0 || rows === 0)
      throw new Error(`the native affairs report is empty: ${tribes} tribes, ${rows} settlements`);
    if (skills < rows || wanted < rows)
      throw new Error(`the native report lacks skills or trade for its ${rows} settlements`);
    if (nations === 0) throw new Error('the foreign affairs report lists no nation');
    for (const [what, s] of [
      ['1280x720', wide],
      ['640x720', narrow],
    ] as const) {
      if (s.h > 0 || s.w > 0) throw new Error(`the foreign affairs report scrolls at ${what}: ${JSON.stringify(s)}`);
    }
  }

  /** The panels a late game must open quickly: Europe, a colony of ours if there is one, some reports, and a save. */
  async tour(): Promise<void> {
    const page = this.page;
    setStep(`${this.scenario}: the panels`);
    await this.shot('map');
    if ((await this.view()).europe) {
      await this.dialogTime('Europe panel', 'europe', () => page.keyboard.press('e'));
      await this.noDialog();
    }
    const m = await this.view();
    const mine = m.settlements.find(
      (s) => s.population >= 0 && s.keys.some((k) => k.includes(m.nation.split('.').pop()!)),
    );
    if (mine) {
      const box = await page.locator('#map canvas').boundingBox();
      const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [mine.x, mine.y]);
      await this.dialogTime(`colony panel of ${mine.name}`, 'colony', () => page.mouse.click(box!.x + px, box!.y + py));
    } else {
      this.note('no colony of ours on the map: no colony panel');
    }
    await this.noDialog();
    for (const [item, title] of [
      ['Colony report', 'Colony Advisor'],
      ['Military report', 'Military Advisor'],
      ['Naval report', 'Naval Advisor'],
      ['Production report', 'Production Report'],
      ['Trade report', 'Trade Advisor'],
    ]) {
      await this.dialogTime(item!, `report: ${title}`, async () => {
        await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
        await page.getByRole('menuitem', { name: new RegExp(`^${item}( (Ctrl\\+)?(Shift\\+)?F\\d+)?$`) }).click();
      });
      await this.noDialog();
    }
    // A save, through the page's save button.
    const name = `scenario ${this.scenario}`;
    const t0 = Date.now();
    await page.fill('#save-name', name);
    await page.click('button[data-command=save]');
    // The save must finish: Firefox once never did in a big empire, its page too busy to hear the Worker (#353).
    await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Saved: ${n}`, name, {
      timeout: 30000,
      label: 'the page says the game is saved',
    });
    this.note(`save: ${secs(Date.now() - t0)} s`);
    await this.shot('after-tour');
  }
}

/** Imports a save file into the page's store, loads it, and says OK to FreeCol's Loading Save game window. */
async function loadSave(run: Run, file: string) {
  const page = run.page;
  setStep(`${run.scenario}: a new game, to import into`);
  await page.goto(`${run.url}?skipstart`);
  await run.finished('the first game');
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('freecol.prefs') ?? '{}');
    p.freecol = { ...p.freecol, 'model.option.showSavegameSettings': 2 };
    localStorage.setItem('freecol.prefs', JSON.stringify(p));
  });
  setStep(`${run.scenario}: import ${path.basename(file)}`);
  const name = path.basename(file, '.fsg');
  await page.setInputFiles('#import-file', file);
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Imported: ${n}`, name, {
    timeout: 60000,
    label: 'the page says it imported the save',
  });
  // The page's autosave moves the rows of the list a moment after its first map: wait until it holds still.
  let last = '';
  let since = Date.now();
  while (Date.now() - since < 3000) {
    const now = await page.evaluate(() =>
      [...document.querySelectorAll('#saves [data-save]')].map((r) => r.getAttribute('data-save')).join(),
    );
    if (now !== last) {
      last = now;
      since = Date.now();
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const id = await page.evaluate(
    (n) =>
      [...document.querySelectorAll('#saves [data-save]')]
        .find((r) => r.textContent?.startsWith(`${n} |`))
        ?.getAttribute('data-save'),
    name,
  );
  if (!id) throw new Error(`the imported ${name} is not in the save list`);
  setStep(`${run.scenario}: load ${name}`);
  const t0 = Date.now();
  await Promise.all([page.waitForURL(/[?&]load=\d+/), page.click(`#saves [data-save="${id}"] [data-load]`)]);
  await page.waitForSelector('[data-loading-save]', { timeout: 60000, label: 'the Loading Save game window' });
  await page.click('[data-load-ok]');
  await run.finished(`loading ${name}`);
  run.note(`${name} loaded in ${secs(Date.now() - t0)} s (the page reloads, and starts the Engine)`);
}

/** Dialog screenshots: the first three of each kind, with and without pictures. */
const dialogShots = (run: () => Run | null) => (kind: string | undefined, n: number) =>
  run()?.shot(`dialog-${(kind ?? 'unknown').replace(/\W+/g, '-')}-${n}`);

/** The tile a unit at (x, y) would attack with a key: an adjacent settlement or unit of another colour. */
function target(m: Awaited<ReturnType<Run['view']>>) {
  if (!m.active) return null;
  const [x, y] = m.active;
  const own = m.units.find((u) => u.x === x && u.y === y)?.rgb;
  const [odd, even] = [(d: (typeof DIRECTIONS)[number]) => d.odd, (d: (typeof DIRECTIONS)[number]) => d.even];
  for (const d of DIRECTIONS) {
    const [dx, dy] = (y & 1 ? odd : even)(d);
    const [tx, ty] = [x + dx, y + dy];
    const there = m.units.find((u) => u.x === tx && u.y === ty && u.rgb !== own);
    const settlement = m.settlements.find((s) => s.x === tx && s.y === ty && s.rgb !== own);
    if (there || settlement)
      return {
        key: d.key,
        at: [tx, ty],
        what: settlement
          ? `settlement ${settlement.name}`
          : `unit ${there?.keys[0]?.replace('image.unit.model.unit.', '')}`,
      };
  }
  return null;
}

/** Combat: every unit that has an enemy beside it attacks it; the rest skip. Until the turns or the attacks run out. */
async function fight(run: Run) {
  const page = run.page;
  let attacks = 0;
  let seenErrors = 0;
  const outcomes: string[] = [];
  for (let turn = 1; turn <= 6 && attacks < 60; turn++) {
    setStep(`combat: turn ${turn}`);
    let idle = 0;
    for (let step = 0; step < 80 && idle < 4; step++) {
      await run.noDialog();
      const m = await run.view();
      if (!m.ourTurn) break;
      const t = m.activeUnit ? target(m) : null;
      const before = await page.evaluate(() => window.__maps);
      if (!m.activeUnit) {
        idle++;
        break;
      }
      if (t) {
        attacks++;
        const unit = m.activeUnit.label;
        await page.keyboard.press(t.key);
        await page.waitForFunction((n: number) => window.__maps > n, before, { timeout: 8000 }).catch(() => idle++);
        await run.noDialog();
        if (attacks <= 10) await run.shot(`attack-${attacks}`);
        // The page's banner counts the Engine's errors: an attack that raised one is marked.
        const errors = await page.evaluate(() =>
          (window.fcErrors ?? []).reduce((n, e) => n + ((e as { count?: number }).count ?? 1), 0),
        );
        const failed = errors > seenErrors ? ' ... the Engine raised an error' : '';
        seenErrors = errors;
        outcomes.push(`turn ${turn}: ${unit} attacks ${t.what} at ${t.at.join(',')}${failed}`);
      } else {
        await page.keyboard.press(' ');
        await page.waitForFunction((n: number) => window.__maps > n, before, { timeout: 4000 }).catch(() => idle++);
      }
    }
    await run.shot(`turn-${turn}-end`);
    await run.endTurn();
  }
  const texts = await page.evaluate(() => window.__dialogTexts);
  run.note(`${attacks} attacks`);
  for (const o of outcomes.slice(0, 30)) run.note(o);
  const kinds = new Map<string, number>();
  for (const d of texts) kinds.set(d.split(':')[0]!, (kinds.get(d.split(':')[0]!) ?? 0) + 1);
  run.note(`dialogs: ${[...kinds].map(([k, n]) => `${k} x${n}`).join(', ')}`);
  fs.writeFileSync(run.file('dialogs').replace('.png', '.txt'), texts.join('\n'));
  if (seenErrors > 0) {
    const detail = await page.evaluate(() => JSON.stringify(window.fcErrors ?? []));
    throw new Error(
      `the Engine raised ${seenErrors} error(s) during the fights (the banner): ${detail.slice(0, 3000)}`,
    );
  }
  if (attacks === 0) throw new Error('the army never had anything to attack');
  const combat = texts.filter((d) =>
    /attack|defeat|captur|plunder|damaged|sunk|demoted|destroy|victory|loses|wins/i.test(d),
  );
  run.note(`combat dialogs: ${combat.length}`);
  for (const c of combat.slice(0, 25)) run.note(`  ${c.slice(0, 200)}`);
  if (combat.length === 0) throw new Error('no combat dialog was shown');
}

// ---- Dialogs no game reaches by itself (#349 part 5). Each scenario holds the dialog's kind (window.__hold), so
// dialogs.ts leaves it open, takes a screenshot with it open (.cache/dialog-shots/METHOD-BROWSER.png), answers it
// and checks that the game went on.
const shotsDir = path.join(cache, 'dialog-shots');
fs.mkdirSync(shotsDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hold = (run: Run, kind: string | null) => run.page.evaluate((k) => (window.__hold = k), kind);
const kindSel = (kind: string) => `[role=dialog][data-kind="${kind}"]`;
/** Waits for a dialog of the kind, and says what it shows. */
async function waitKind(run: Run, kind: string, what: string, timeout = 120000) {
  await run.page.waitForSelector(kindSel(kind), { timeout, label: `${what}: a ${kind} dialog opens` });
  await sleep(300);
  const text = (await run.page.locator(kindSel(kind)).last().textContent()) ?? '';
  run.note(`${what}: ${kind} dialog: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
  return text;
}
/** The screenshot of a dialog left open, for the person who reviews how the dialog looks. */
const dialogShot = (run: Run, method: string) =>
  run.page.screenshot({ path: path.join(shotsDir, `${method}-${run.browser}.png`) });
const clickIn = async (run: Run, kind: string, selector: string) => {
  const text = (await run.page.locator(kindSel(kind)).first().textContent()) ?? '';
  await run.page
    .locator(`${kindSel(kind)} ${selector}`)
    .first()
    .click();
  // The next dialog of the kind may open at once: the one answered is gone when no dialog has its text.
  await run.page.waitForFunction(
    ([k, t]: [string, string]) => ![...document.querySelectorAll(k)].some((d) => d.textContent === t),
    [kindSel(kind), text] as [string, string],
    {
      timeout: 60000,
      label: `the ${kind} dialog closes`,
    },
  );
};
const gold = (run: Run) =>
  run.page.evaluate(() => Number(/Gold: (\d+)/.exec(document.querySelector('#statusLine')?.textContent ?? '')?.[1]));

/** Presses the active unit's way to the enemy beside it: true if it did. Skips a unit with nothing beside it. */
async function pressTarget(run: Run, want: RegExp): Promise<boolean> {
  const m = await run.view();
  if (!m.ourTurn) return false;
  if (!m.activeUnit) {
    await run.page.keyboard.press('w');
    return false;
  }
  const t = target(m);
  const before = await run.page.evaluate(() => window.__maps);
  if (t && want.test(m.activeUnit.label)) {
    run.note(`${m.activeUnit.label} moves ${t.key} onto ${t.what}`);
    await run.page.keyboard.press(t.key);
  } else {
    await run.page.keyboard.press(' ');
    await run.page.waitForFunction((n: number) => window.__maps > n, before, { timeout: 5000 }).catch(() => {});
    return false;
  }
  return true;
}

/** Skips and moves units until one matching `want` has a target and has been pressed at it. */
async function findAndPress(run: Run, want: RegExp, what: string) {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    if ((await run.page.locator('[role=dialog]').count()) > 0) {
      await sleep(300);
      continue;
    }
    if (await pressTarget(run, want)) return;
  }
  throw new Error(`${what}: no ${want} unit had a target`);
}

const scenarios: Record<string, (run: Run) => Promise<void>> = {
  'capture-goods': async (run) => {
    const page = run.page;
    await page.goto(`${run.url}?skipstart&debug&preset=capture-goods`);
    await run.finished('capture goods');
    await hold(run, 'goods');
    await run.shot('start');
    // Every warship beside the loaded galleon attacks it in turn, until one wins and may loot it.
    let found = false;
    for (let i = 0; i < 120 && !found; i++) {
      await sleep(200);
      if ((await page.locator(kindSel('goods')).count()) > 0) {
        found = true;
        break;
      }
      if ((await page.locator('[role=dialog]').count()) > 0) continue;
      const m = await run.view();
      if (!m.ourTurn) continue;
      if (!m.activeUnit) {
        await page.keyboard.press('w');
        continue;
      }
      const before = await page.evaluate(() => window.__maps);
      if (await pressTarget(run, /Privateer|Frigate/)) {
        await page
          .waitForFunction(
            (n: number) => window.__maps > n || !!document.querySelector('[role=dialog][data-kind="goods"]'),
            before,
            { timeout: 8000 },
          )
          .catch(() => {});
      }
    }
    if (!found) throw new Error('no warship won against the galleon');
    const text = await waitKind(run, 'goods', 'capture goods');
    if (!/Sugar|Silver|Muskets/i.test(text)) throw new Error(`the capture dialog names no goods: ${text}`);
    await dialogShot(run, 'showCaptureGoodsDialog');
    // None is checked at first: take the first goods that fit, as a player would.
    await page
      .locator(`${kindSel('goods')} input[type=checkbox]`)
      .first()
      .check();
    await clickIn(run, 'goods', '[data-answer=ok]');
    await hold(run, null);
    await run.shot('after-loot');
    const m = await run.view();
    if (m.units.some((u) => u.keys.some((k) => k.includes('galleon') && k.includes('french')))) {
      run.note('a French galleon is still on the map (the winner may have only damaged it)');
    }
    await run.playTurns(1);
  },
  'dump-cargo': async (run) => {
    const page = run.page;
    await page.goto(`${run.url}?skipstart&debug&preset=dump-cargo`);
    await run.finished('dump cargo');
    // Open Europe and activate the galleon from its menu: it becomes the active unit, as a ship that has arrived is.
    await sleep(3000);
    await hold(run, 'europe');
    await page.click('button[data-command=showEurope]');
    await waitKind(run, 'europe', 'dump cargo');
    await run.shot('europe');
    await page
      .locator(`${kindSel('europe')} [data-unit]`)
      .first()
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Activate/ }).click();
    await sleep(500);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role=dialog][data-kind="europe"]'), null, {
      timeout: 30000,
    });
    await hold(run, 'goods');
    await page.keyboard.press('u');
    const text = await waitKind(run, 'goods', 'dump cargo');
    await dialogShot(run, 'showDumpCargoDialog');
    if (!/Sugar/i.test(text)) throw new Error(`the dump dialog does not offer the boycotted sugar: ${text}`);
    await clickIn(run, 'goods', '[data-answer=ok]');
    await hold(run, null);
    await sleep(1500);
    await run.shot('after-dump');
  },
  'native-demand': async (run) => {
    const page = run.page;
    await page.addInitScript(() => (window.__hold = 'confirm'));
    await page.goto(`${run.url}?skipstart&debug&preset=native-demand`);
    await run.finished('native demand');
    // Food, sugar and gold are demanded: the first and the last are accepted, the sugar refused.
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const text = await waitKind(run, 'confirm', `native demand ${i + 1}`);
      seen.push(text);
      if (i === 0) await dialogShot(run, 'showNativeDemandDialog');
      await run.shot(`demand-${i + 1}`);
      const refuse = /sugar/i.test(text);
      const before = await gold(run);
      await clickIn(run, 'confirm', refuse ? '[data-answer=cancel]' : '[data-answer=ok]');
      run.note(`demand ${i + 1}: ${refuse ? 'refused' : 'accepted'}; gold ${before}`);
      // The braves are the debug action's: the AI mission that hands the goods or gold over is not theirs, so
      // only the answer reaches the server (the session closes), and the colony is not changed.
    }
    if (!seen.some((t) => /food|50/i.test(t))) throw new Error('no food demand');
    await hold(run, null);
    await run.playTurns(1);
  },
  diplomacy: async (run) => {
    const page = run.page;
    await page.goto(`${run.url}?skipstart&debug&preset=diplomacy`);
    await run.finished('diplomacy');
    await page.waitForFunction(
      () => window.__map.units.reduce((n, u) => n + u.stack, 0) >= 8 && window.__map.settlements.length >= 2,
      null,
      { timeout: 300000, polling: 500, label: 'the preset has put its units round the French colony' },
    );
    await sleep(2000);
    await run.shot('start');
    // A scout meets the French: negotiate.
    await hold(run, 'choice');
    await findAndPress(run, /Scout/, 'scout');
    await waitKind(run, 'choice', 'scout');
    await run.shot('scout-choice');
    await hold(run, 'negotiation');
    await clickIn(run, 'choice', 'button[data-choice]:not(:disabled):has-text("egotiat")');
    await waitKind(run, 'negotiation', 'scout');
    await dialogShot(run, 'showNegotiationDialog');
    await clickIn(run, 'negotiation', '[data-answer=send], [data-answer=cancel]');
    await sleep(3000);
    // A soldier demands tribute: the amount, then the demand itself as a negotiation.
    await hold(run, 'choice');
    await findAndPress(run, /Soldier/, 'soldier');
    await waitKind(run, 'choice', 'soldier');
    await run.shot('soldier-choice');
    await hold(run, 'input');
    await clickIn(run, 'choice', 'button[data-choice]:not(:disabled):has-text("ribute")');
    await waitKind(run, 'input', 'tribute');
    await dialogShot(run, 'showSelectTributeAmountDialog');
    await page.locator(`${kindSel('input')} input`).fill('5');
    // The demand goes straight to the French with the amount: the AI takes the 5 gold for peace.
    const before = await gold(run);
    await hold(run, null);
    await clickIn(run, 'input', '[data-answer=ok]');
    await page
      .waitForFunction(
        (g: number) => Number(/Gold: (\d+)/.exec(document.querySelector('#statusLine')!.textContent!)?.[1]) !== g,
        before,
        { timeout: 60000, label: 'the tribute arrives' },
      )
      .catch(() => {});
    run.note(`gold ${before} -> ${await gold(run)} after demanding 5 tribute`);
    await sleep(3000);
    await run.shot('after-diplomacy');
    await run.playTurns(1);
  },
  independence: async (run) => {
    const page = run.page;
    // The player signs the Declaration in their own name: a neutral one, for the screenshots.
    await page.addInitScript(() =>
      localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.playerName': 'William I' } })),
    );
    // The Declaration's picture and signature font load when it opens, and not before (#347).
    const fetched: string[] = [];
    page.on('request', (r: { url(): string }) => {
      if (/doi\.png|signature\.faf|victory\.png/.test(r.url())) fetched.push(r.url().replace(/^.*\//, ''));
    });
    await page.goto(`${run.url}?skipstart&debug&preset=independence`);
    await run.finished('independence');
    await page.waitForFunction(() => window.__map.settlements.some((s) => s.population >= 0), null, {
      timeout: 300000,
      polling: 500,
      label: 'the preset has founded its colony',
    });
    await sleep(5000);
    if (fetched.length > 0) throw new Error(`fetched before the Declaration opened: ${fetched.join(', ')}`);
    await hold(run, 'names');
    await page.getByRole('button', { name: /^Declare independence/ }).click();
    await sleep(2000);
    run.note(`dialogs after the menu item: ${(await page.evaluate(() => window.__dialogs)).slice(-4).join(' | ')}`);
    await waitKind(run, 'names', 'declare');
    await dialogShot(run, 'showConfirmDeclarationDialog');
    if (fetched.length > 0) throw new Error(`fetched before the Declaration opened: ${fetched.join(', ')}`);
    await hold(run, 'declaration');
    await clickIn(run, 'names', '[data-answer=ok]');
    // The panel is FreeCol's picture of the Declaration: no text, no buttons, the name signed over it.
    const text = await waitKind(run, 'declaration', 'declaration');
    if (text.trim() !== '') throw new Error(`the declaration panel has text: ${text}`);
    if (/Resolution/i.test(await page.evaluate(() => document.body.innerText)))
      throw new Error('the resolution is on the page with the Declaration');
    const declaration = kindSel('declaration');
    await page.waitForFunction(
      (sel: string) => {
        const img = document.querySelector<HTMLImageElement>(`${sel} img`);
        return img?.complete && img.naturalWidth === 525 && img.naturalHeight === 624;
      },
      declaration,
      { timeout: 30000, label: 'the Declaration picture loads at 525x624' },
    );
    for (const f of ['doi.png', 'signature.faf'])
      if (!fetched.includes(f))
        throw new Error(`${f} was not fetched when the Declaration opened: ${fetched.join(', ')}`);
    run.note(`fetched on opening: ${fetched.join(', ')}`);
    const signed = await page.locator(`${declaration} canvas`).getAttribute('data-signature');
    if (signed !== 'William I') throw new Error(`the signature says ${signed}`);
    // Mid-signature: after the 2 s wait, some of the strokes are drawn.
    await page.waitForFunction(
      (sel: string) => Number(document.querySelector<HTMLElement>(`${sel} canvas`)?.dataset.drawn ?? 0) > 400,
      declaration,
      { timeout: 30000, polling: 20, label: 'the signature is being drawn' },
    );
    const phase = await page.locator(declaration).getAttribute('data-phase');
    if (phase !== 'signing') throw new Error(`the panel is ${phase} mid-signature`);
    await dialogShot(run, 'showDeclarationPanel-signing');
    await page.waitForFunction(
      (sel: string) => document.querySelector(sel)?.getAttribute('data-phase') === 'signed',
      declaration,
      { timeout: 60000, label: 'the signature is finished' },
    );
    await dialogShot(run, 'showDeclarationPanel-signed');
    await hold(run, null);
    // A click closes it, and the declaration goes to the server.
    await page.locator(declaration).click();
    await page.waitForFunction(() => !document.querySelector('[role=dialog][data-kind="declaration"]'), null, {
      timeout: 30000,
      label: 'the Declaration closes',
    });
    await sleep(3000);
    await run.shot('after-declaration');
    const m = await run.view();
    run.note(`nation after declaring: ${m.nation}`);
    await run.playTurns(1);
  },
  victory: async (run) => {
    const page = run.page;
    await page.goto(`${run.url}?skipstart&debug&preset=victory`);
    await run.finished('victory');
    await page.waitForFunction(() => window.__map.settlements.some((s) => s.population >= 0), null, {
      timeout: 300000,
      polling: 500,
      label: 'the preset has founded its colony',
    });
    await sleep(3000);
    // The REF has nothing left: it is defeated as the turn ends, and the Dutch are independent. The turn after,
    // they have won.
    await run.playTurns(1);
    await hold(run, 'confirm,highScores');
    // The high scores and the victory dialog arrive together, in either order. Turns go by until they do.
    let victory = '';
    let scores = false;
    for (let i = 0; i < 1200 && !(victory && scores); i++) {
      if (i % 60 === 0) {
        await page.waitForFunction(() => window.__map.ourTurn, null, { timeout: 120000, label: 'our turn' });
        const m = await run.view();
        run.note(
          `turn ${m.turn}, nation ${m.nation}; dialogs: ${(await page.evaluate(() => window.__dialogs)).slice(-3).join(' | ')}`,
        );
        if (i > 0 && !victory) await page.keyboard.press('Enter');
        if (i === 0) await page.keyboard.press('Enter');
      }
      await sleep(500);
      if (!scores && (await page.locator(kindSel('highScores')).count()) > 0) {
        const t = await waitKind(run, 'highScores', 'high scores');
        await dialogShot(run, 'showHighScoresPanel');
        scores = true;
        await clickIn(run, 'highScores', '[data-answer=close]');
        run.note(`high scores: ${t.length} characters`);
      }
      if (!victory && (await page.locator(kindSel('confirm')).count()) > 0) {
        victory = await waitKind(run, 'confirm', 'victory');
        await dialogShot(run, 'showVictoryDialog');
      }
    }
    if (!victory) throw new Error('no victory dialog');
    if (!scores) throw new Error('no high scores panel');
    if (!/victor|won|win/i.test(victory)) throw new Error(`the victory dialog says: ${victory}`);
    // FreeCol's VictoryDialog: the line as a header in the title font over the Continental soldier (132x275).
    const soldier = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('[role=dialog][data-kind="confirm"] img.picture');
      const head = document.querySelector('[role=dialog][data-kind="confirm"] h3.headline');
      return img ? { w: img.naturalWidth, h: img.naturalHeight, head: head?.textContent ?? null } : null;
    });
    if (!soldier || soldier.w !== 132 || soldier.h !== 275 || !soldier.head)
      throw new Error(`the victory dialog has no soldier under a header: ${JSON.stringify(soldier)}`);
    await hold(run, null);
    // "Continue playing" is the cancel button.
    await clickIn(run, 'confirm', '[data-answer=cancel]');
    await sleep(2000);
    await run.shot('after-victory');
  },

  'desktop-late-game': async (run) => {
    await loadSave(run, path.join(saves, '2026-11-04-desktop-long-game-turn173.fsg'));
    const m = await run.view();
    if (!/173/.test(m.turn) || m.nation !== 'model.nation.dutch') {
      throw new Error(`the desktop save came up as ${m.nation} at turn ${m.turn}, not Dutch at 173`);
    }
    await run.playTurns(turns);
    await run.affairsReports();
    await run.tour();
  },
  'ai-late-game': async (run) => {
    await loadSave(run, path.join(saves, '2026-11-06-ai-round-300.fsg'));
    const m = await run.view();
    if (Number(m.turn) < 250) throw new Error(`the AI's save came up at turn ${m.turn}`);
    await run.playTurns(turns);
    await run.tour();
  },
  'big-empire': async (run) => {
    const t0 = Date.now();
    await run.page.goto(`${run.url}?skipstart&debug&preset=big-empire`);
    await run.finished('the big empire');
    run.note(`the game started in ${secs(Date.now() - t0)} s; the preset's setup goes on after it`);
    // The setup (thirty colonies, a fleet and an army) runs after the game starts: wait until the colonies are all there.
    await run.page.waitForFunction(() => window.__map.settlements.filter((s) => s.population >= 0).length >= 30, null, {
      timeout: 900000,
      polling: 500,
      label: 'the preset has founded its thirty colonies',
    });
    run.note(`thirty colonies after ${secs(Date.now() - t0)} s`);
    // Founding is the first thing each colony block does; the buildings follow: the last block is the fleet.
    await run.page.waitForFunction(() => window.__map.units.reduce((n, u) => n + u.stack, 0) >= 16, null, {
      timeout: 900000,
      polling: 500,
      label: 'the preset has put its fleet on the map',
    });
    run.note(`fleet on the map after ${secs(Date.now() - t0)} s`);
    // The fleet is the setup's last block, but the page is still working through the server's updates and the maps
    // they cause, and a click waits behind them: time the panels once it is quiet.
    await run.quiet(3000);
    run.note(`setup done, the page quiet, after ${secs(Date.now() - t0)} s`);
    const m = await run.view();
    const colonies = m.settlements.filter((s) => s.population >= 0).length;
    run.note(`${colonies} colonies, ${m.units.reduce((n, u) => n + u.stack, 0)} units on the map`);
    await run.tour();
    await run.playTurns(Math.min(turns, 3));
  },
  combat: async (run) => {
    await run.page.goto(`${run.url}?skipstart&debug&preset=combat`);
    await run.finished('the combat scenario');
    await run.shot('start');
    await fight(run);
  },
};

const names = Object.keys(scenarios).filter((n) => only.length === 0 || only.includes(n));
const server = await serveDist();
let failed = false;
for (const browserName of browsers) {
  for (const name of names) {
    const browser = await launchBrowser(browserName);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = collectPageErrors(page);
    let run: Run | null = new Run(page, name, browserName, server.url);
    const tail = run.consoleTail;
    const keep = (who: string) => (m: { type(): string; text(): string }) => {
      tail.push(`${who} [${m.type()}] ${m.text().slice(0, 300)}`);
      if (tail.length > 200) tail.shift();
    };
    page.on('console', keep('page'));
    page.on('worker', (w) => w.on('console', keep('worker')));
    await page.addInitScript(() => {
      let inner: ((name: string, detail: string) => unknown) | undefined;
      window.__maps = 0;
      Object.defineProperty(window, 'fcClientEvent', {
        configurable: true,
        get: () => inner,
        set: (f: (name: string, detail: string) => unknown) => {
          inner = (n: string, detail: string) => {
            if (n === 'map' || n === 'gameStarted') {
              window.__map = JSON.parse(detail);
              window.__maps++;
              // How long the AI plays: from the first map of the other players' turns to the next of the player's.
              window.__aiMs ??= [];
              if (!window.__map.ourTurn && !window.__aiAt) window.__aiAt = performance.now();
              if (window.__map.ourTurn && window.__aiAt) {
                window.__aiMs.push(Math.round(performance.now() - window.__aiAt));
                window.__aiAt = 0;
              }
            }
            return f(n, detail);
          };
        },
      });
      window.__shotPlain = true;
    });
    await answerDialogs(
      page,
      dialogShots(() => run),
    );
    console.log(`\n${name} in ${browserName}`);
    const t = Date.now();
    try {
      await scenarios[name]!(run);
      console.log(`ok: ${name} in ${browserName}, ${secs(Date.now() - t)} s`);
      if (errors.length) console.log(`  page errors: ${errors.join('; ')}`);
    } catch (ex) {
      failed = true;
      console.log(`FAIL: ${name} in ${browserName}: ${await diagnose(ex)}`);
      await run.shot('failed').catch(() => {});
    }
    run = null;
    await browser.close().catch(() => {});
  }
}
server.close();
process.exit(failed ? 1 : 0);
