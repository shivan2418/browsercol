// The installed app's service worker (#296), in the built site: after one visit a second start works with the
// network gone, with every picture and preset cached, and a new build is offered as a Restart and picked up through it. Chromium only (the install
// prompt is Chromium's). Screenshots of the update offer go to .cache/offline/. The "new build" is dist/play/sw.js with another name in it, put back at the end.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/offline.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import playwright from 'playwright-core';
import { collectPageErrors, diagnose, launchBrowser, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { listFiles, soundEffects } from './pwa.ts';
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
  // Only on the first load: the offline audio choice made later in Preferences must stay.
  await context.addInitScript(() => {
    if (!localStorage.getItem('freecol.prefs'))
      localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.languageOption': 'de' } }));
  });
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
  // The menu bar says when the copy is in.
  await page.waitForSelector('.offline-status[data-offline=ready]', { timeout: 120000 });
  check(`the menu bar says ${await page.textContent('.offline-status')}`, true);
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
  // The sound effects too, played yet or not (#505); the music waits for the player's say.
  const effects = soundEffects(fs.readFileSync(path.join(dist, 'play', 'audio', 'audio.json'), 'utf8')).map(
    (f) => `/browsercol/play/${f}`,
  );
  const effectsMissing = effects.filter((f) => !cached.includes(f));
  check(
    `every sound effect is cached (${effects.length - effectsMissing.length}/${effects.length})`,
    effects.length > 1 && effectsMissing.length === 0,
  );

  // The translation the page loaded before the worker was in goes through it again once it takes over.
  await poll(
    page,
    'the German translation in the cache',
    async (name: string) =>
      (await (await caches.open(name)).keys()).some((r) => r.url.endsWith('/strings/FreeColMessages_de.properties')),
    cache,
  );
  check('the German translation is cached', true);

  // The music: only the tracks played are cached until the player asks for all of them (#505).
  const audioFiles = listFiles(path.join(dist, 'play', 'audio')).map((f) => `/browsercol/play/audio/${f}`);
  const cachedAudio = (name: string) =>
    page.evaluate(
      async (n) =>
        (await (await window.caches.open(n)).keys())
          .map((r) => new URL(r.url).pathname)
          .filter((p) => p.includes('/audio/')),
      name,
    );
  check(
    `not every music file is cached before the player asks (${(await cachedAudio(cache)).length})`,
    (await cachedAudio(cache)).length < audioFiles.length,
  );
  await page.keyboard.press('Control+p');
  await page.locator('#preferences').waitFor({ timeout: 20000 });
  await page.locator('[data-category="clientOptions.audio"]').click();
  const control = page.locator('[data-pref=offlineAudio]');
  await control.waitFor({ timeout: 20000 });
  fs.mkdirSync(shots, { recursive: true });
  await poll(
    page,
    'the worker to answer the audio status',
    () => document.querySelector('[data-pref=offlineAudio]')?.getAttribute('data-status') === 'idle',
  );
  check('the control is enabled once a worker controls the page', await control.locator('button').isEnabled());
  await page.locator('#preferences').screenshot({ path: path.join(shots, 'prefs-audio-before.png') });
  await control.locator('button').click();
  await poll(
    page,
    'the audio download to finish',
    () => document.querySelector('[data-pref=offlineAudio]')?.getAttribute('data-status') === 'done',
  );
  console.log(`     ${await control.locator('[data-offline-audio-note]').textContent()}`);
  check('the control says it is saved', ((await control.textContent()) ?? '').includes('Saved for offline'));
  check('it offers Remove', (await control.locator('button').textContent()) === 'Remove');
  await page.locator('#preferences').screenshot({ path: path.join(shots, 'prefs-audio-done.png') });
  const audioNow = await cachedAudio(cache);
  const lacking = audioFiles.filter((f) => !audioNow.includes(f));
  check(
    `every file of audio/ is cached (${audioFiles.length - lacking.length}/${audioFiles.length})`,
    lacking.length === 0,
  );
  check(
    'the browser was asked to keep the storage',
    await page.evaluate(() => navigator.storage.persisted()).then((p) => typeof p === 'boolean'),
  );
  await page.keyboard.press('Escape');

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
  // A track this page never played, with the network gone: a whole one, and a range of it as an audio element asks.
  const track = audioFiles[audioFiles.length - 1]!;
  const fetched = await page.evaluate(async (file) => {
    const whole = await fetch(file);
    const range = await fetch(file, { headers: { Range: 'bytes=0-99' } });
    return { ok: whole.ok, bytes: (await whole.arrayBuffer()).byteLength, range: range.status };
  }, track);
  check(`a track never played loads offline (${track}, ${fetched.bytes} bytes)`, fetched.ok && fetched.bytes > 1000);
  check('and answers a range request', fetched.range === 206);
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
  // The player chose the audio: the new build's fresh cache is filled again, without asking.
  await poll(
    page,
    'the audio in the new build cache',
    async (arg: string) => {
      const [name, count] = arg.split('|');
      return (await (await caches.open(name!)).keys()).filter((r) => r.url.includes('/audio/')).length >= Number(count);
    },
    `browsercol-next-build|${audioFiles.length}`,
  );
  check(`the new build's cache gets the audio again by itself (${audioFiles.length} files)`, true);

  // A build after that, found from the start screen, where no game is in play: it takes over by itself, with no offer.
  fs.writeFileSync(swFile, original.replace(/const BUILD = "[^"]*"/, 'const BUILD = "third-build"'));
  await page.goto(server.url);
  await poll(
    page,
    'the third build to take over by itself',
    async () =>
      (await window.caches.keys()).filter((k) => k.startsWith('browsercol-')).join() === 'browsercol-third-build',
  );
  check('on the start screen a new build takes over by itself', true);
  check('with no offer to restart', (await page.locator('.update-prompt').count()) === 0);

  // The copy costs no second download of what the page loads. In a profile on disk, as a player's: a fresh context
  // keeps its HTTP cache in memory, too small for the Engines, so there the worker's fetch would miss it anyway.
  // The first context goes first: its worker would fetch sw.js put back, and its downloads would count.
  await context.close();
  fs.writeFileSync(swFile, original);
  server.served!().clear();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-profile-'));
  const player = await playwright.chromium.launchPersistentContext(profile, {});
  try {
    const tab = player.pages()[0] ?? (await player.newPage());
    await tab.goto(server.url);
    await tab.waitForSelector('.offline-status[data-offline=ready]', { timeout: 180000 });
    await tab.goto(`${server.url}?skipstart`);
    const game = await waitForResult(tab, 300000);
    const big = [...server.served!().entries()].filter(([p]) =>
      /\/assets\/(client|server|data)-[^/]+\.(wasm|json)$/.test(p),
    );
    const counts = big.map(([p, n]) => `${path.basename(p)} ${n}x`).join(', ');
    check(
      `the start screen's copy and then a game download the Engines and the data once (${counts})`,
      game.status === 'finished' && big.length === 3 && big.every(([, n]) => n === 1),
    );
  } finally {
    await player.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
} catch (ex) {
  console.log(`FAILED: ${await diagnose(ex)}`);
  failed = true;
} finally {
  fs.writeFileSync(swFile, original);
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
