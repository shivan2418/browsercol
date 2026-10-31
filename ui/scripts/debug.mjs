// Browser check of debug mode on the built site: with ?debug the side panel has
// the debug menu and each action reaches the server Engine in the Worker and
// comes back as the client's update; without it there is no menu.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/debug.mjs [--browsers chromium,firefox]
import { createRequire } from 'node:module';
import { answerDialogs } from './dialogs.mjs';
import { serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const i = process.argv.indexOf('--browsers');
const browsers = (i < 0 ? 'chromium' : process.argv[i + 1]).split(',');
const server = await serveDist();
const base = `${server.url}?preset=dutch-small`;
const timeout = 600_000;

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  failed ||= !ok;
};

/** The player's gold, from the status line. */
const gold = (page) => page.$eval('#statusLine', (e) => Number(/Gold: (\d+)/.exec(e.textContent)?.[1]));
const turn = (page) => page.$eval('#turn', (e) => e.textContent);

for (const name of browsers) {
  const browser = await playwright[name].launch();

  // Outside debug mode: no menu.
  const plain = await browser.newPage();
  await answerDialogs(plain);
  await plain.goto(`${base}&autoplay=0`);
  await plain.waitForFunction(() => window.fcResult?.status === 'finished', null, { timeout });
  check(`${name}: no debug menu without ?debug`, (await plain.$('#debug')) === null);
  await plain.close();

  // In debug mode: the menu, and its actions.
  const page = await browser.newPage();
  await answerDialogs(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}&debug&autoplay=0`);
  await page.waitForFunction(() => window.fcResult?.status === 'finished', null, { timeout });
  check(`${name}: the debug menu is there with ?debug`, (await page.$('#debug')) !== null);

  const before = await gold(page);
  await page.fill('input[aria-label="Gold"]', '500');
  await page.click('button[data-debug="gold"]');
  await page.waitForFunction(
    (g) => /Gold: (\d+)/.exec(document.querySelector('#statusLine').textContent)?.[1] == g,
    before + 500,
    {
      timeout: 60_000,
    },
  );
  check(
    `${name}: add gold reaches the client`,
    (await gold(page)) === before + 500,
    `${before} -> ${await gold(page)}`,
  );

  await page.click('button[data-debug="reveal"]');
  await page.waitForFunction(() => document.querySelector('#debug-note').textContent === 'Map revealed', null, {
    timeout: 60_000,
  });
  check(`${name}: reveal map answers`, true);

  await page.click('button[data-debug="aiView"]');
  await page.waitForFunction(
    () => /gold, \d+ settlements/.test(document.querySelector('#debug-note').textContent),
    null,
    {
      timeout: 60_000,
    },
  );
  check(`${name}: AI view lists the AI players`, true);

  const t0 = await turn(page);
  await page.fill('input[aria-label="Turns"]', '2');
  await page.click('button[data-debug="skip"]');
  // Two AI rounds, then play comes back: "finished" with two rounds played.
  await page.waitForFunction(
    () => window.fcResult?.status === 'finished' && window.fcResult.rounds.length === 2,
    null,
    {
      timeout,
    },
  );
  await page.waitForFunction(() => !document.querySelector('#turn').textContent.includes('AI playing'), null, {
    timeout: 60_000,
  });
  check(`${name}: skip turns advances the game`, (await turn(page)) !== t0, `${t0} -> ${await turn(page)}`);
  check(`${name}: no page errors`, errors.length === 0, errors.join('; '));
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
