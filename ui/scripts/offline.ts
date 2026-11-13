// The installed app's service worker (#296), in the built site: after one visit a second start works with the
// network gone, with every picture and preset cached, and a new build is offered as a Restart and picked up through it. Chromium only (the install
// prompt is Chromium's). Screenshots of the update offer go to .cache/offline/. The "new build" is dist/play/sw.js with another name in it, put back at the end.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/offline.ts
import fs from 'node:fs';
import path from 'node:path';
import { collectPageErrors, diagnose, launchBrowser, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { listFiles } from './pwa.ts';
import { dist, serveDist } from './serve-dist.ts';
import type { Page } from 'playwright-core';

const server = await serveDist();
/** The "new version" offer as the player sees it, for a look by eye. */
const shots = path.resolve(import.meta.dirname, '../../.cache/offline');
const swFile = path.join(dist, 'play', 'sw.js');
const original = fs.readFileSync(swFile, 'utf8');
const browser = await launchBrowser('chromium');
let failed = false;
const check = (what: string, ok: boolean) => {
  console.log(`${ok ? 'ok' : 'FAILED'}: ${what}`);
  failed ||= !ok;
};

/**
 * Polls `fn` in the page until it gives a truthy value, and returns it. Not page.waitForFunction, which does not
 * wait out an async function's promise, and not across a reload: a poll the page's reload cuts short is tried again.
 */
async function poll(page: Page, what: string, fn: (arg: string) => unknown, arg = '', ms = 120000): Promise<unknown> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await page.evaluate(fn, arg).catch(() => undefined);
    if (value) return value;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`timed out waiting: ${what}`);
}

try {
  const context = await browser.newContext();
  // In German, so the translation, loaded before the worker is in, has to be kept for the offline start.
  await context.addInitScript(() =>
    localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.languageOption': 'de' } })),
  );
  const page = await context.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  const url = `${server.url}?skipstart`;
  await page.goto(url);
  const first = await waitForResult(page, 300000);
  check('the first start finishes', first.status === 'finished');
  // The worker installs beside the game, then takes the page over.
  const cache = (await poll(page, 'the worker to install', async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ? (await window.caches.keys()).find((k) => k.startsWith('browsercol-')) : undefined;
  })) as string;
  check(`the shell is cached (${cache})`, !!cache);
  await poll(page, 'the worker to take the page over', () => !!navigator.serviceWorker.controller);
  check('the page that registered it is taken over', true);
  // Every picture of every Tileset and every preset is in after one visit, drawn yet or not.
  const cached = await page.evaluate(
    async (name) => (await (await window.caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
    cache!,
  );
  for (const dir of ['art', 'presets']) {
    const want = listFiles(path.join(dist, 'play', dir)).map((f) => `/browsercol/play/${dir}/${f}`);
    const missing = want.filter((f) => !cached.includes(f));
    check(`every file of ${dir}/ is cached (${want.length - missing.length}/${want.length})`, missing.length === 0);
  }

  // The translation the page loaded before the worker was in goes through it again once it takes over.
  await poll(
    page,
    'the German translation in the cache',
    async (name: string) =>
      (await (await caches.open(name)).keys()).some((r) => r.url.endsWith('/strings/FreeColMessages_de.properties')),
    cache,
  );
  check('the German translation is cached', true);

  // Straight after the first visit, with no second load online.
  await context.setOffline(true);
  await page.goto(url);
  const second = await waitForResult(page, 300000);
  check('a second start works offline', second.status === 'finished');
  check('it is in German offline', (await page.textContent('body'))!.includes('Niederländisch'));
  check('the offline load is controlled by it', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!;
    return (await (await fetch(link.href)).json()) as { icons: { src: string }[] };
  });
  check('the manifest is linked and has icons', manifest.icons.length === 3);
  check('the page drew no errors offline', errors.length === 0);
  await context.setOffline(false);

  // A new build: the same site under another name.
  fs.writeFileSync(swFile, original.replace(/const BUILD = "[^"]*"/, 'const BUILD = "next-build"'));
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();
  });
  await page.waitForSelector('.update-prompt', { timeout: 60000 });
  check('the new version is offered', (await page.textContent('.update-prompt'))!.includes('A new version is ready'));
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'update-prompt.png') });
  await page.locator('.update-prompt').screenshot({ path: path.join(shots, 'update-prompt-close.png') });
  // The reload is seen by a marker the old page has and the new one has not.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));
  await page.click('.update-prompt button');
  await poll(page, 'the page to reload', () => !('notReloaded' in window));
  await waitForResult(page, 300000);
  const kept = await page.evaluate(async () => (await window.caches.keys()).filter((k) => k.startsWith('browsercol-')));
  check(`Restart swaps the build and drops the old cache (${kept.join()})`, kept.join() === 'browsercol-next-build');
} catch (ex) {
  console.log(`FAILED: ${await diagnose(ex)}`);
  failed = true;
} finally {
  fs.writeFileSync(swFile, original);
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
