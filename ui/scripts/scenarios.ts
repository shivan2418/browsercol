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
// The saves are the Engine's fixtures (engine/src/test/resources/saves), which the Engine tests load too.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/scenarios.ts [--only desktop-late-game,combat] [--browsers chromium,firefox] [--turns 5]
// Exits non-zero unless every scenario plays in every browser. It prints the AI's round times.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import type { Page } from 'playwright-core';

const browsers = browserNames();
const turns = Number(opt('turns', '5'));
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
    await this.page.keyboard.press('Enter');
    // A long wait says what the page is doing every half minute: dialogs answered, AI rounds played, the status line.
    const t0 = Date.now();
    let presses = 0;
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
      if (idle && presses < 6) {
        presses++;
        this.note(`the turn is back with the player, no unit active: Enter again (${presses})`);
        await this.page.keyboard.press('Enter');
        continue;
      }
      if (Date.now() - noted < 30000) continue;
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
      if (Date.now() - t0 > 1500000) throw new Error(`turn ${turn} did not end in 25 minutes`);
    }
    return this.view();
  };
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

  /** The panels a late game must open quickly: Europe, a colony of ours if there is one, some reports, and a save. */
  async tour(): Promise<boolean> {
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
    // Firefox never finished saving the big empire in ten minutes: that is told, not thrown, so the scenario's
    // other numbers still come out (and no turn is played in a game whose Worker is stuck saving).
    const saved = await page
      .waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Saved: ${n}`, name, {
        timeout: 180000,
        label: 'the page says the game is saved',
      })
      .then(() => true)
      .catch((ex: Error) => {
        if (!/Timeout/i.test(ex.message)) throw ex;
        return false;
      });
    this.note(
      saved ? `save: ${secs(Date.now() - t0)} s` : `SLOW: the save did not finish in ${secs(Date.now() - t0)} s`,
    );
    await this.shot('after-tour');
    return saved;
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
  if (attacks === 0) throw new Error('the army never had anything to attack');
  const combat = texts.filter((d) =>
    /attack|defeat|captur|plunder|damaged|sunk|demoted|destroy|victory|loses|wins/i.test(d),
  );
  run.note(`combat dialogs: ${combat.length}`);
  for (const c of combat.slice(0, 25)) run.note(`  ${c.slice(0, 200)}`);
  if (combat.length === 0) throw new Error('no combat dialog was shown');
}

const scenarios: Record<string, (run: Run) => Promise<void>> = {
  'desktop-late-game': async (run) => {
    await loadSave(run, path.join(saves, '2026-11-04-desktop-long-game-turn173.fsg'));
    const m = await run.view();
    if (!/173/.test(m.turn) || m.nation !== 'model.nation.dutch') {
      throw new Error(`the desktop save came up as ${m.nation} at turn ${m.turn}, not Dutch at 173`);
    }
    await run.playTurns(turns);
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
    run.note(`setup done after ${secs(Date.now() - t0)} s`);
    const m = await run.view();
    const colonies = m.settlements.filter((s) => s.population >= 0).length;
    run.note(`${colonies} colonies, ${m.units.reduce((n, u) => n + u.stack, 0)} units on the map`);
    if (await run.tour()) await run.playTurns(Math.min(turns, 3));
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
