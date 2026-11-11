// Screenshots of the panels that draw a Box, to check that a caption that wraps pushes the content down instead of
// running over it (the caption is in flow, #419-style bug). Writes .cache/box-shots/TAG-BROWSER-NAME.png and prints,
// for each shot, how many captions are on screen, how many wrap, and how many end below where their box's content
// starts. The start screen's option editor and new game's more options are shot as they are; with --save PATH.fsg the
// save is imported and loaded, and its colonies, Europe, the preferences and the game options are shot too. --zoom
// and --font set the UI scale and the font size (the Preferences' display scaling and font size) for a second pass.
// Run against dist/ (the negotiation windows are the diplomacy scenario's, scenarios.ts --only diplomacy):
//   DEV_VARIANT=web ./dev.sh node ui/scripts/box-shots.ts [--browsers chromium,firefox] [--tag before|after]
//     [--save PATH.fsg | --preset NAME] [--long 1] [--widest 1] [--zoom 1.5] [--font 1.5]
// --widest sets every amount in the colony's warehouse to 300 and checks it is one row, with nothing cut off or scrolling.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { browserNames, collectPageErrors, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const tag = opt('tag', 'after');
const save = opt('save', '');
const preset = opt('preset', '');
const zoom = opt('zoom', '');
const font = opt('font', '');
/** Print every box's sizes, not only those that scroll (--sizes 1). */
const sizes = opt('sizes', '') !== '';
/** Lengthen the colony's captions to what a long ship name or another language makes of them (--long). */
const long = opt('long', '') !== '';
/** Make every amount in the colony's warehouse 300, the widest the game shows (--widest). */
const widest = opt('widest', '') !== '';
const dir = path.resolve(import.meta.dirname, '../../.cache/box-shots');
fs.mkdirSync(dir, { recursive: true });
const server = await serveDist();
let failed = false;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Every captioned .box in view: its caption's lines, and whether the caption ends below its first content. */
const captions = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.box')].flatMap((b) => {
      const cap = b.querySelector<HTMLElement>(':scope > .cap');
      if (!cap) return [];
      const r = cap.getBoundingClientRect();
      // The caption overlaps a sibling that is drawn: their rectangles share an area.
      const overlap = [...b.children].some((c) => {
        if (c === cap || (c as HTMLElement).offsetParent === null) return false;
        const n = c.getBoundingClientRect();
        return (
          n.width > 0 &&
          n.height > 0 &&
          r.bottom > n.top + 2 &&
          r.top < n.bottom &&
          r.left < n.right &&
          r.right > n.left
        );
      });
      const lines = Math.round(r.height / parseFloat(getComputedStyle(cap).lineHeight));
      // A fixed-height box whose content does not fit scrolls: by how many pixels.
      const overflow = Math.max(0, b.scrollHeight - b.clientHeight);
      // The tallest item in the box and the caption's height, to size the boxes' fixed heights by.
      const tallest = Math.max(
        0,
        ...[...b.children].filter((c) => c !== cap).map((c) => (c as HTMLElement).offsetHeight),
      );
      const cs = getComputedStyle(b);
      const sizes = `cap ${cap.offsetHeight} tallest ${tallest} box ${b.clientHeight} pad ${cs.paddingTop}/${cs.paddingBottom} gap ${cs.rowGap}`;
      return [{ cap: cap.textContent, lines, overlap, overflow, sizes }];
    }),
  );

/** The warehouse's goods: how many, in how many rows, and whether any is cut off or the box scrolls (#449). */
const warehouse = (page: Page) =>
  page.evaluate(() => {
    const w = document.querySelector<HTMLElement>('.colony .warehouse');
    if (!w) return null;
    const items = [...w.querySelectorAll<HTMLElement>('.stored')];
    const box = w.getBoundingClientRect();
    const rows = new Set(items.map((i) => Math.round(i.getBoundingClientRect().top))).size;
    const cut = items.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5 || r.left < box.left - 0.5;
    }).length;
    return {
      goods: items.length,
      width: Math.round(items.reduce((n, i) => n + i.getBoundingClientRect().width, 0)),
      box: Math.round(box.width),
      rows,
      cut,
      vscroll: w.scrollHeight - w.clientHeight,
      hscroll: w.scrollWidth - w.clientWidth,
      overflowY: getComputedStyle(w).overflowY,
    };
  });

for (const browserName of browserNames()) {
  const browser = await launchBrowser(browserName);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = collectPageErrors(page);
  const suffix = (zoom || font ? `-z${zoom || 1}f${font || 1}` : '') + (long ? '-long' : '');
  const shot = async (name: string, el?: string) => {
    if (widest)
      await page.evaluate(() => {
        for (const a of document.querySelectorAll('.colony .warehouse .stored .amount')) a.textContent = '300';
      });
    const file = path.join(dir, `${tag}-${browserName}-${name}${suffix}.png`);
    if (el) await page.locator(el).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
    const c = await captions(page);
    // A caption over the content fails, and so does a one-line caption's box that scrolls: the box's fixed height
    // must hold what it is sized for (the warehouse's one line of goods) without a scroll bar.
    const bad = c.filter((x) => x.overlap || (x.overflow > 0 && x.lines === 1));
    const scrolls = c.filter((x) => x.overflow > 0 || sizes).map((x) => `${x.cap} +${x.overflow}px (${x.sizes})`);
    console.log(
      `${bad.length ? 'FAIL' : 'ok  '} ${tag}/${browserName}/${name}${suffix}: ${c.length} captions, ${c.filter((x) => x.lines > 1).length} wrapped, ${c.filter((x) => x.overlap).length} overlapping, scrolling: ${scrolls.join(' | ') || 'none'}`,
    );
    const wh = await warehouse(page);
    if (wh) console.log(`     warehouse ${tag}/${browserName}/${name}${suffix}: ${JSON.stringify(wh)}`);
    failed ||= bad.length > 0 || (!!wh && (wh.rows > 1 || wh.cut > 0 || wh.vscroll > 0 || wh.hscroll > 0));
  };
  const look = () =>
    page.evaluate(
      ([z, f]) => {
        const s = document.documentElement.style;
        if (z) s.setProperty('--ui-zoom', z);
        if (f)
          for (const [t, px] of [
            ['--fs', 15],
            ['--fs-s', 13],
            ['--fs-h', 17],
          ] as const)
            s.setProperty(t, `${Math.round(px * Number(f))}px`);
      },
      [zoom, font],
    );
  try {
    // The start screen: the option editor's tabs (difficulty, game, map, colours), as new game's more options.
    await page.goto(server.url);
    await page.waitForSelector('[data-start]', { timeout: 60000 });
    await look();
    for (const t of ['difficulty', 'game', 'map', 'colours']) {
      await page.click(`[data-customize-tab=${t}]`);
      await sleep(300);
      await shot(`start-${t}`);
    }
    if (save || preset) {
      await answerDialogs(page);
      await page.addInitScript(() => {
        window.__hold = 'colony,europe,options,preferences,negotiation,gameOptions,difficulty,mapOptions';
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
      if (preset) await page.goto(`${server.url}?skipstart&debug&preset=${preset}`);
      else {
        await page.goto(`${server.url}?skipstart`);
        await page.waitForSelector('#import-file', { state: 'attached', timeout: 120000 });
        await page.setInputFiles('#import-file', save);
        await page.waitForFunction(
          () => (document.querySelector('#save-note')?.textContent ?? '').startsWith('Imported'),
          null,
          {
            timeout: 30000,
          },
        );
        await sleep(1500);
        const row = page.locator('#saves [data-save]', { hasText: /^e \|/ }).first();
        await Promise.all([page.waitForURL(/[?&]load=\d+/), row.locator('[data-load]').click()]);
        // The Loading Save game window asks first for some saves; others load at once.
        await page.waitForSelector('[data-loading-save]', { timeout: 20000 }).then(
          () => page.click('[data-load-ok]'),
          () => {},
        );
      }
      const r = await waitForResult(page, 300000);
      if (r.status !== 'finished') throw new Error(`no game: ${JSON.stringify(r)}`);
      await page.waitForFunction(
        () => window.__map?.ourTurn && window.__map.settlements.some((s) => s.population >= 0),
        null,
        { timeout: 120000, polling: 500 },
      );
      await sleep(3000);
      await look();

      // Europe.
      // Not a pointer click: at a small zoom the Beta tag lies over this button.
      await page.locator('button[data-command=showEurope]').dispatchEvent('click');
      await page.locator('[role=dialog][data-kind=europe]').waitFor({ timeout: 20000 });
      await sleep(1000);
      await shot('europe');
      await page.keyboard.press('Escape');
      await sleep(500);

      // The colony with a ship in port: each of the player's colonies in turn until one has one.
      const mine = (await page.evaluate(() => window.__map.settlements)).filter((s) => s.population >= 0);
      const box = (await page.locator('#map canvas').boundingBox())!;
      for (const [i, s] of mine.entries()) {
        const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [s.x, s.y]);
        await page.mouse.click(box.x + px, box.y + py);
        const win = page.locator('[role=dialog][data-kind=colony]');
        await win.waitFor({ timeout: 20000 });
        await sleep(1500);
        if (long)
          await win.evaluate((w) => {
            for (const c of w.querySelectorAll('.box > .cap'))
              c.textContent = `${c.textContent} of the Fortuyn (Dutch Merchantman) (3 holds left)`;
          });
        const ship = await win.locator('.port .ship').count();
        const outside = await win.locator('.outside [data-unit]').count();
        await shot(`colony-${i}-ship${ship}-outside${outside}`, '[role=dialog][data-kind=colony]');
        await page.keyboard.press('Escape');
        await sleep(500);
        if (i >= 3) break;
      }

      // The preferences and the game's options, read-only.
      await page.keyboard.press('Control+p');
      await page.locator('#preferences').waitFor({ timeout: 20000 });
      await sleep(500);
      await shot('preferences');
      await page.keyboard.press('Escape');
      await sleep(300);
      for (const item of ['Show Game Options', 'Show Map Generator Options', 'Show Difficulty Level']) {
        await page.locator('[role=menubar] >> text=Report').first().click();
        await page.locator(`[role=menuitem]:has-text("${item}")`).first().click();
        await sleep(1500);
        await shot(item.toLowerCase().replaceAll(' ', '-'));
        await page.keyboard.press('Escape');
        await sleep(300);
      }
    }
  } catch (ex) {
    failed = true;
    console.error(`${browserName}: ${ex instanceof Error ? ex.message : String(ex)}`);
    await page.screenshot({ path: path.join(dir, `${tag}-${browserName}-error.png`) }).catch(() => {});
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
