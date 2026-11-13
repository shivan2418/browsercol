// The stacking check (#504, docs/adr/0008): in a real game, nothing from the map, the minimap, the info panel, the
// turn banner or the side panel may draw over a window. At 1280x720 and 1280x800 (where the minimap's buttons once
// drew over the Preferences), each window that sits over the map's corners and edges is opened, and for a grid of
// points inside its box `document.elementFromPoint` must land inside that window. The menu bar's menu must be over
// the map, and a window's pop-up list over the window.
//
// The game is the Dutch 1632 save the landing page's carousel shows, imported into dist/ (as carousel-shots.ts does).
// Run in the web image, after `just build`:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/z-layers.ts [--browsers chromium,firefox] [--save PATH.fsg]
// or `just browser z-layers`.
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';
import type { Page } from 'playwright-core';

const save = path.resolve(
  opt(
    'save',
    path.resolve(import.meta.dirname, '../../engine/src/test/resources/saves/2026-11-04-desktop-long-game-turn173.fsg'),
  ),
);
const dir = path.resolve(import.meta.dirname, '../../.cache/z-layers');
fs.mkdirSync(dir, { recursive: true });
// The saves list names an import by its file name: copy it under a name the script can find.
const named = path.join(dir, 'z-layers.fsg');
fs.copyFileSync(save, named);

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
];
/** The windows are held open for the check: every kind this script opens. */
const HELD = 'colony,europe,report,preferences,endTurn,messages';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Points of a grid inside `box` (a fraction in from each edge) where something other than `inside` is on top. */
const covered = (page: Page, rootSel: string, insideSel: string) =>
  page.evaluate(
    ([rootSel, insideSel]) => {
      const root = [...document.querySelectorAll(rootSel)].pop();
      if (!root) return { error: `no ${rootSel}` };
      const inside = [...document.querySelectorAll(insideSel)].pop() ?? root;
      const r = root.getBoundingClientRect();
      const left = Math.max(r.left, 0);
      const top = Math.max(r.top, 0);
      const right = Math.min(r.right, innerWidth) - 1;
      const bottom = Math.min(r.bottom, innerHeight) - 1;
      const over: string[] = [];
      const N = 12;
      for (let i = 0; i <= N; i++)
        for (let j = 0; j <= N; j++) {
          const x = Math.round(left + ((right - left) * i) / N);
          const y = Math.round(top + ((bottom - top) * j) / N);
          const el = document.elementFromPoint(x, y);
          if (el && inside.contains(el)) continue;
          const name = el
            ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).replace(/\s+/g, '.') : ''}`
            : 'nothing';
          const region = el?.closest('#game, #side, #menubar, #overlays')?.id ?? '';
          over.push(`(${x},${y}) ${region ? region + ' > ' : ''}${name}`);
        }
      return {
        box: [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)],
        over,
        points: (N + 1) * (N + 1),
      };
    },
    [rootSel, insideSel],
  );

const failures: string[] = [];
const server = await serveDist();
for (const name of browserNames()) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage({ viewport: SIZES[0] });
  await answerDialogs(page);
  await page.addInitScript((held) => {
    window.__hold = held;
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
  }, HELD);
  const errors = collectPageErrors(page);
  let size = '';
  /** The window of this kind is on top of everything inside its box. */
  const check = async (what: string, rootSel: string, insideSel = rootSel) => {
    await sleep(700);
    const r = await covered(page, rootSel, insideSel);
    if ('error' in r) {
      failures.push(`${name} ${size} ${what}: ${r.error}`);
      return console.log(`FAIL ${name} ${size} ${what}: ${r.error}`);
    }
    const ok = r.over.length === 0;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${name} ${size} ${what}: box ${r.box!.join(',')}, ${r.over.length} of ${r.points} points covered`,
    );
    if (!ok) {
      failures.push(`${name} ${size} ${what}: ${r.over.length} points covered, e.g. ${r.over.slice(0, 3).join('; ')}`);
      await page.screenshot({ path: path.join(dir, `${name}-${size}-${what.replace(/\W+/g, '-')}.png`) });
    }
  };
  const kind = (k: string) => `[role=dialog][data-kind="${k}"], [role=dialog]#${k}`;
  const menu = async (title: string) =>
    page.locator('[role=menubar] [role=menuitem]', { hasText: title }).first().click();
  /** Escape closes the window on top; wait for it to be gone. */
  const close = async (sel: string) => {
    await page.keyboard.press('Escape');
    await page.locator(sel).last().waitFor({ state: 'detached', timeout: 20000 });
  };
  try {
    setStep(`${name}: the saved game loads`);
    await page.goto(`${server.url}?skipstart`);
    await page.waitForSelector('#import-file', { state: 'attached', timeout: 120000 });
    await page.setInputFiles('#import-file', named);
    await page.waitForFunction(
      () => (document.querySelector('#save-note')?.textContent ?? '').startsWith('Imported'),
      null,
      { timeout: 30000 },
    );
    await sleep(1500);
    const row = page.locator('#saves [data-save]', { hasText: /^z-layers \|/ }).first();
    await Promise.all([page.waitForURL(/[?&]load=\d+/), row.locator('[data-load]').click()]);
    await page.waitForSelector('[data-loading-save]', { timeout: 20000 }).then(
      () => page.click('[data-load-ok]'),
      () => {},
    );
    const r = await waitForResult(page, 300000);
    if (r.status !== 'finished') throw new Error(`no game: ${JSON.stringify(r)}`);
    await page.waitForFunction(
      () => window.__map?.ourTurn && window.__map.settlements.some((s) => s.population >= 0),
      null,
      { timeout: 120000, polling: 500 },
    );
    await sleep(4000);

    for (const viewport of SIZES) {
      size = `${viewport.width}x${viewport.height}`;
      setStep(`${name} ${size}: the windows`);
      await page.setViewportSize(viewport);
      await sleep(1500);
      await page.mouse.move(viewport.width / 2, 12);

      // The menu bar's menu is over the map.
      await menu('Game');
      await page.locator('[role=menu]').first().waitFor({ timeout: 10000 });
      await check('menu', '.menubar [role=menu]');
      await page.keyboard.press('Escape');

      // Preferences, over the minimap's corner, and a pop-up list from it.
      await menu('Game');
      await page.locator('[role=menuitem]', { hasText: /^Preferences/ }).click();
      await page.locator(kind('preferences')).waitFor({ timeout: 20000 });
      await check('preferences', kind('preferences'));
      const select = page.locator(`${kind('preferences')} .ui-select`).first();
      if (await select.count()) {
        await select.click();
        await page.locator('.ui-positioner').first().waitFor({ timeout: 10000 });
        await check('preferences pop-up list', '.ui-positioner');
        await page.keyboard.press('Escape');
        await sleep(300);
      } else console.log(`  ${name} ${size}: no select in the Preferences`);
      if (await page.locator(kind('preferences')).count()) await close(kind('preferences'));

      // A report, by FreeCol's key for it.
      await page.keyboard.press('F6');
      await page.locator(kind('report')).waitFor({ timeout: 20000 });
      await check('report', kind('report'));
      await close(kind('report'));

      // Europe.
      await page.locator('button[data-command=showEurope]').dispatchEvent('click');
      await page.locator(kind('europe')).waitFor({ timeout: 20000 });
      await check('europe', kind('europe'));
      await close(kind('europe'));

      // The colony panel.
      const colony = (await page.evaluate(() => window.__map.settlements)).find((s) => s.name === 'Metropolis');
      if (!colony) throw new Error('the save has no colony named Metropolis');
      const box = (await page.locator('#map canvas').boundingBox())!;
      const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [colony.x, colony.y]);
      await page.mouse.click(box.x + px, box.y + py);
      await page.locator(kind('colony')).waitFor({ timeout: 20000 });
      await page.mouse.move(viewport.width / 2, 12);
      await check('colony', kind('colony'));
      await close(kind('colony'));

      // The end turn dialog, when units still wait.
      await page.keyboard.press('Enter');
      const endTurn = page.locator(kind('endTurn'));
      if (
        await endTurn.waitFor({ timeout: 10000 }).then(
          () => true,
          () => false,
        )
      ) {
        await check('end turn', kind('endTurn'));
        await close(kind('endTurn'));
      } else failures.push(`${name} ${size}: no end turn dialog`);
    }

    // A model message: the turn ends, and the new turn's messages are shown.
    size = 'turn change';
    await page.evaluate(() => (window.__hold = 'messages'));
    const turn = await page.evaluate(() => window.__map.turn);
    for (let i = 0; i < 40 && (await page.evaluate(() => window.__map.turn)) === turn; i++) {
      await page.keyboard.press('Enter');
      await sleep(500);
      const ok = page.locator(`${kind('endTurn')} [data-answer=ok]`);
      if (await ok.count()) await ok.click();
      if (await page.locator(kind('messages')).count()) break;
    }
    const messages = page.locator(kind('messages'));
    if (
      await messages
        .first()
        .waitFor({ timeout: 60000 })
        .then(
          () => true,
          () => false,
        )
    ) {
      await check('model message', kind('messages'));
    } else failures.push(`${name}: no model message came with the turn change`);
    if (errors.length) failures.push(`${name}: page errors: ${errors.join(' | ')}`);
  } catch (ex) {
    failures.push(`${name} ${size}: ${await diagnose(ex)}`);
    await page.screenshot({ path: path.join(dir, `${name}-error.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}
server.close();
if (failures.length) {
  console.log(`\nFAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('every window is on top of the page at 1280x720 and 1280x800');
