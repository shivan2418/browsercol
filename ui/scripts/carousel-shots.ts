// The landing page's carousel screenshots (ui/site/img, #374, #455), and a few more views of the same game to pick from:
// a save is imported into dist/ and loaded at 1280x800, and the map, Metropolis, the Colony Advisor, the Continental
// Congress and the Foreign Affairs Advisor are shot as the carousel has them, then the trade routes panel and its route
// editor, Europe, other reports and the open menus. Writes .cache/carousel-shots/BROWSER-NAME.png.
//   DEV_VARIANT=web ./dev.sh node ui/scripts/carousel-shots.ts --save PATH.fsg [--browsers chromium] [--colony Metropolis]
// The save is the Dutch spring 1632 game (turn 173) the carousel has always shown. The site's WebPs are the PNGs at
// cwebp's default quality, which keeps them the size they were:
//   magick .cache/carousel-shots/chromium-game.png -define webp:method=6 -quality 75 ui/site/img/game.webp
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, collectPageErrors, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const save = opt('save', '');
if (!save) throw new Error('--save PATH.fsg is needed');
const colonyName = opt('colony', 'Metropolis');
const dir = path.resolve(import.meta.dirname, '../../.cache/carousel-shots');
fs.mkdirSync(dir, { recursive: true });
// The saves list names an import by its file name: copy it under a name the script can find.
const named = path.join(dir, 'carousel.fsg');
fs.copyFileSync(save, named);
const server = await serveDist();
let failed = false;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

for (const browserName of browserNames('chromium')) {
  const browser = await launchBrowser(browserName);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = collectPageErrors(page);
  const shot = async (name: string) => {
    await sleep(800);
    const file = path.join(dir, `${browserName}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${file}`);
  };
  /** Close the window on top, and wait for it to go. */
  const close = async () => {
    await page.keyboard.press('Escape');
    await sleep(600);
  };
  /** Open a menu bar menu, shoot it, and close it. */
  const menu = async (title: string, name: string) => {
    await page.locator('[role=menubar] [role=menuitem]', { hasText: title }).first().click();
    await sleep(400);
    await shot(name);
    await close();
  };
  try {
    await answerDialogs(page);
    await page.addInitScript(() => {
      window.__hold = 'colony,europe,report,tradeRoutes';
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
    await page.goto(`${server.url}?skipstart`);
    await page.waitForSelector('#import-file', { state: 'attached', timeout: 120000 });
    await page.setInputFiles('#import-file', named);
    await page.waitForFunction(
      () => (document.querySelector('#save-note')?.textContent ?? '').startsWith('Imported'),
      null,
      { timeout: 30000 },
    );
    await sleep(1500);
    const row = page.locator('#saves [data-save]', { hasText: /^carousel \|/ }).first();
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
    // No debug side panel: the View menu's Show Side Panel turns it off.
    await page.locator('[role=menubar] [role=menuitem]', { hasText: 'View' }).first().click();
    const sidePanel = page.locator('[role=menuitemcheckbox]', { hasText: 'Show Side Panel' }).first();
    if ((await sidePanel.getAttribute('aria-checked')) === 'true') await sidePanel.click();
    else await page.keyboard.press('Escape');
    // The map was centred beside the side panel: centre it again on the active unit, as the old shots were.
    await sleep(1000);
    // Not at an edge, where a resting pointer scrolls the map, nor over anything with a tooltip.
    await page.mouse.move(600, 12);
    await page.keyboard.press('Control+c');
    // The map's art and the turn's messages settle.
    await sleep(6000);
    await page.mouse.move(600, 12);
    await shot('game');

    // The reports, by FreeCol's keys for them (reports.tsx, #478), as the carousel's and a few more.
    for (const [key, name] of [
      ['F3', 'colonies'],
      ['F6', 'congress'],
      ['F4', 'foreign-affairs'],
      ['F2', 'labour'],
      ['F5', 'native-affairs'],
      ['F7', 'military'],
      ['F9', 'trade'],
    ] as const) {
      await page.keyboard.press(key);
      await page
        .locator('[role=dialog][data-kind=report]')
        .waitFor({ timeout: 20000 })
        .catch(() => console.log(`  ${name}: no report window`));
      await sleep(1500);
      await shot(name);
      await close();
    }

    // The colony.
    const colony = (await page.evaluate(() => window.__map.settlements)).find((s) => s.name === colonyName);
    if (!colony) throw new Error(`no colony named ${colonyName}`);
    const box = (await page.locator('#map canvas').boundingBox())!;
    const [px, py] = await page.evaluate(([x, y]) => window.fcReveal!(x, y), [colony.x, colony.y]);
    await page.mouse.click(box.x + px, box.y + py);
    await page.locator('[role=dialog][data-kind=colony]').waitFor({ timeout: 20000 });
    await page.mouse.move(600, 12);
    await sleep(1500);
    await shot('colony');
    await close();

    // The trade routes, and the editor on the first route.
    await page.locator('button[data-command=tradeRoutes]').dispatchEvent('click');
    const routes = page.locator('[role=dialog][data-kind=tradeRoutes]');
    await routes.waitFor({ timeout: 20000 });
    await routes.locator('[data-route]').first().click();
    await shot('trade-routes');
    await routes.locator('[data-answer=edit]').click();
    await routes.locator('[data-stop]').first().waitFor({ timeout: 10000 });
    await sleep(1000);
    await shot('trade-route-editor');
    await routes.locator('[data-answer=cancel]').click();
    await sleep(500);
    await routes.locator('[data-answer=close]').click();
    await sleep(500);

    // Europe.
    await page.locator('button[data-command=showEurope]').dispatchEvent('click');
    await page.locator('[role=dialog][data-kind=europe]').waitFor({ timeout: 20000 });
    await sleep(1500);
    await shot('europe');
    await close();

    // The menus, open over the map.
    await menu('Game', 'menu-game');
    await menu('View', 'menu-view');
    await menu('Orders', 'menu-orders');
    await menu('Report', 'menu-report');
  } catch (ex) {
    failed = true;
    console.error(`${browserName}: ${ex instanceof Error ? ex.message : String(ex)}`);
    await page.screenshot({ path: path.join(dir, `${browserName}-error.png`) }).catch(() => {});
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
