// The installed app's service worker (#267), in the built site: after one visit a second start works with the
// network gone, and a new build is offered as a Restart and picked up through it. Chromium only (the install
// prompt is Chromium's). The "new build" is dist/sw.js with another name in it, put back at the end.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/offline.ts
import fs from 'node:fs';
import path from 'node:path';
import { collectPageErrors, diagnose, launchBrowser, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';

const server = await serveDist();
const swFile = path.join(dist, 'sw.js');
const original = fs.readFileSync(swFile, 'utf8');
const browser = await launchBrowser('chromium');
let failed = false;
const check = (what: string, ok: boolean) => {
  console.log(`${ok ? 'ok' : 'FAILED'}: ${what}`);
  failed ||= !ok;
};

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  const url = `${server.url}?skipstart`;
  await page.goto(url);
  const first = await waitForResult(page, 300000);
  check('the first start finishes', first.status === 'finished');
  // The worker installs beside the game; it takes over from the next load on.
  const cache = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return (await window.caches.keys()).find((k) => k.startsWith('browsercol-'));
  });
  check(`the shell is cached (${cache})`, !!cache);
  check(
    'the page that registered it is not taken over',
    await page.evaluate(() => !navigator.serviceWorker.controller),
  );

  await page.reload();
  await waitForResult(page, 300000);
  check('the next load is controlled by it', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!;
    return (await (await fetch(link.href)).json()) as { icons: { src: string }[] };
  });
  check('the manifest is linked and has icons', manifest.icons.length === 3);

  await context.setOffline(true);
  await page.goto(url);
  const second = await waitForResult(page, 300000);
  check('a second start works offline', second.status === 'finished');
  check('the page drew no errors offline', errors.length === 0);
  await context.setOffline(false);

  // A new build: the same site under another name.
  fs.writeFileSync(swFile, original.replace(/const BUILD = '[^']*'/, "const BUILD = 'next-build'"));
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.update();
  });
  await page.waitForSelector('.update-prompt', { timeout: 60000 });
  check('the new version is offered', (await page.textContent('.update-prompt'))!.includes('A new version is ready'));
  // The reload is seen by a marker the old page has and the new one has not.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));
  await page.click('.update-prompt button');
  await page.waitForFunction(() => !('notReloaded' in window), null, { timeout: 60000 });
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
