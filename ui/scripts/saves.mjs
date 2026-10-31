// Saves and loads a game in the built site, through the page's own side panel
// (#68): start a game, play a turn, save it under a name, reload the page (a
// new game starts, and the save is in the list from IndexedDB), load the save,
// check it comes back at the saved turn with the saved active unit and the
// player's turn, and play another turn. Exits non-zero unless every browser
// gets there. The page's dialogs are answered as scripts/dialogs.mjs says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/saves.mjs [--browsers chromium,firefox]
import path from 'node:path';
import { createRequire } from 'node:module';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const browsers = opt('browsers', 'chromium,firefox').split(',');
const SAVE_NAME = 'script save';

/** Play with the page of one browser; returns what was checked. */
async function run(page, url, shot) {
  // Keep the latest map view the client Engine sends, as play.mjs does.
  await page.addInitScript(() => {
    let inner;
    window.__maps = 0;
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f) => {
        inner = (name, detail) => {
          if (name === 'map' || name === 'gameStarted') {
            window.__map = JSON.parse(detail);
            window.__maps++;
          }
          return f(name, detail);
        };
      },
    });
  });
  await answerDialogs(page);

  const view = () => page.evaluate(() => window.__map);
  const noDialog = () => page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 10000 });
  const finished = async () => {
    await page.waitForFunction(() => window.fcResult, null, { timeout: 300000 });
    const r = await page.evaluate(() => window.fcResult);
    if (r.status !== 'finished') throw new Error(`the page did not start a game: ${JSON.stringify(r)}`);
    // The first map view and the active unit have arrived.
    await page.waitForFunction(() => window.__map?.ourTurn, null, { timeout: 60000 });
  };
  const endTurn = async () => {
    const turn = (await view()).turn;
    await noDialog();
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => window.__map.turn !== t && window.__map.ourTurn, turn, { timeout: 120000 });
    return view();
  };
  const rows = () =>
    page.evaluate(() => [...document.querySelectorAll('#saves [data-save]')].map((r) => r.textContent ?? ''));

  // 1. A new game, one turn played.
  await page.goto(url);
  await finished();
  const played = await endTurn();
  await noDialog();
  const active = (await view()).activeUnit?.id ?? null;
  if (!active) throw new Error('no active unit to save');

  // 2. Save it.
  await page.fill('#save-name', SAVE_NAME);
  await page.click('button[data-command=save]');
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Saved: ${n}`, SAVE_NAME, {
    timeout: 60000,
  });
  const [row] = await rows();
  if (!row?.startsWith(`${SAVE_NAME} |`) || !row.includes(`turn ${played.turn}`)) {
    throw new Error(`the save list does not show the save: ${JSON.stringify(row)}`);
  }

  // 3. Reload: a new game starts, and the save is still listed.
  await page.goto(url);
  await finished();
  await page.waitForFunction(() => document.querySelectorAll('#saves [data-save]').length > 0, null, {
    timeout: 10000,
  });
  const listed = await rows();
  if (listed.length !== 1 || !listed[0].startsWith(`${SAVE_NAME} |`)) {
    throw new Error(`the save list after a reload: ${JSON.stringify(listed)}`);
  }
  const fresh = await view();
  if (fresh.turn === played.turn) throw new Error('the reloaded page is not a new game');

  // 4. Load it: the page reloads on the saved game.
  await noDialog();
  await Promise.all([page.waitForURL(/[?&]load=\d+/), page.click('#saves [data-save] [data-load]')]);
  await finished();
  const loaded = await view();
  if (loaded.turn !== played.turn || !loaded.ourTurn || loaded.activeUnit?.id !== active) {
    throw new Error(
      `the loaded game is at turn ${loaded.turn} with active unit ${loaded.activeUnit?.id}` +
        ` (ourTurn ${loaded.ourTurn}); saved at turn ${played.turn} with ${active}`,
    );
  }
  await shot();

  // 5. Play a turn in the loaded game.
  const next = await endTurn();
  if (next.turn === played.turn) throw new Error('the loaded game did not go on');
  return { saved: played.turn, loaded: loaded.turn, active, next: next.turn };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t = Date.now();
  let line;
  try {
    const r = await run(page, server.url, () =>
      page.screenshot({ path: path.join(dist, `../.cache/saves-${name}.png`) }),
    );
    line = `ok: saved at turn ${r.saved}, loaded at turn ${r.loaded} with ${r.active}, played on to turn ${r.next}`;
  } catch (ex) {
    failed = true;
    line = `failed: ${String(ex)}`;
  }
  failed ||= errors.length > 0;
  await browser.close();
  console.log(
    `${name} ${browser.version()}: ${line}, ${((Date.now() - t) / 1000).toFixed(1)} s` +
      `${errors.length ? ', page errors: ' + errors.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
