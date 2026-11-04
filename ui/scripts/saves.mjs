// Saves and loads a game in the built site, through the page's own side panel
// (#68, #69): start a game, play a turn, save it under a name, reload the page
// (a new game starts, and the save is in the list from IndexedDB), export the
// save as a file, delete it, import the file again (a file that is not a save is
// refused), check the export is byte for byte the import, load the save, check
// it comes back at the saved turn with the saved active unit and the player's
// turn (through FreeCol's Loading Save game window), and play another turn. The turn autosaves FreeCol makes as each turn
// begins are checked after the first turn. The page's autosaves sit in the list beside
// the script's save, so the script finds its own row by name. Exits non-zero
// unless every browser gets there. The page's dialogs are answered as scripts/dialogs.mjs says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/saves.mjs [--browsers chromium,firefox] [--keep-export DIR]
// --keep-export copies each browser's exported .fsg to DIR (for tools/desktop-check.sh).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.mjs';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const browsers = browserNames();
const keepExport = opt('keep-export', '');
const SAVE_NAME = 'script save';

/** Play with the page of one browser; returns what was checked. */
async function run(page, url, shot, browserName) {
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
    const r = await waitForResult(page, 300000);
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
  /** The rows of the script's own save, not the autosaves: their ids and text. */
  const ownRows = () =>
    page.evaluate(
      (n) =>
        [...document.querySelectorAll('#saves [data-save]')]
          .map((r) => ({ id: r.getAttribute('data-save'), text: r.textContent ?? '' }))
          .filter((r) => r.text.startsWith(`${n} |`)),
      SAVE_NAME,
    );
  /** The one row of the script's save; throws, with the whole list, if there is not exactly one. */
  const ownRow = async (what) => {
    const own = await ownRows();
    if (own.length !== 1) throw new Error(`${what}: ${JSON.stringify(await rows())}`);
    return own[0];
  };
  /** Wait until the list shows `count` rows of the script's save. */
  const waitOwn = (count) =>
    page.waitForFunction(
      ([n, c]) =>
        [...document.querySelectorAll('#saves [data-save]')].filter((r) => r.textContent?.startsWith(`${n} |`))
          .length === c,
      [SAVE_NAME, count],
      { timeout: 10000 },
    );

  // 1. A new game, one turn played.
  await page.goto(url);
  await finished();
  const played = await endTurn();
  await noDialog();
  const active = (await view()).activeUnit?.id ?? null;
  if (!active) throw new Error('no active unit to save');
  // FreeCol's autosaves as each of the player's turns began (#154): the last-turn save of this
  // turn, the before-last-turn save of the first, and a turn autosave of each.
  const autosaves = {
    'Autosave-last-turn': played.turn,
    'Autosave-before-last-turn': played.turn - 1,
    [`Autosave-${played.turnLabel}`]: played.turn,
  };
  await page
    .waitForFunction(
      (want) =>
        Object.entries(want).every(([n, t]) =>
          [...document.querySelectorAll('#saves [data-save]')].some(
            (r) => r.textContent?.startsWith(`${n} |`) && r.textContent.includes(`turn ${t} `),
          ),
        ),
      autosaves,
      { timeout: 30000 },
    )
    .catch(async () => {
      throw new Error(
        `the save list lacks the turn autosaves ${JSON.stringify(autosaves)}: ${JSON.stringify(await rows())}`,
      );
    });

  // 2. Save it.
  await page.fill('#save-name', SAVE_NAME);
  await page.click('button[data-command=save]');
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Saved: ${n}`, SAVE_NAME, {
    timeout: 60000,
  });
  await waitOwn(1);
  const row = await ownRow('the save list does not show the save once');
  if (!row.text.includes(`turn ${played.turn}`)) {
    throw new Error(`the save list does not show the save: ${JSON.stringify(row.text)}`);
  }

  // 3. Reload: a new game starts, and the save is still listed.
  await page.goto(url);
  await finished();
  await waitOwn(1);
  const listed = await ownRow('the save list after a reload');
  const fresh = await view();
  if (fresh.turn === played.turn) throw new Error('the reloaded page is not a new game');

  // 4. Export it, delete it, import the file, and refuse a file that is no save.
  const exportOne = async (id) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(`#saves [data-save="${id}"] [data-export]`),
    ]);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    return { file, name: download.suggestedFilename(), bytes: fs.readFileSync(file) };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saves-'));
  const exported = await exportOne(listed.id);
  if (exported.name !== `${SAVE_NAME}.fsg` || exported.bytes.subarray(0, 2).toString() !== 'PK') {
    throw new Error(`the export is ${exported.name}, ${exported.bytes.length} bytes, not a zip named for the save`);
  }
  await page.click(`#saves [data-save="${listed.id}"] [data-delete]`);
  await waitOwn(0);
  const junk = path.join(tmp, 'junk.fsg');
  fs.writeFileSync(junk, 'this is not a save');
  await page.setInputFiles('#import-file', junk);
  await page.waitForFunction(
    () => document.querySelector('#save-note')?.textContent?.startsWith('Import failed: '),
    null,
    {
      timeout: 10000,
    },
  );
  if ((await ownRows()).length !== 0) throw new Error('a file that is no save was imported');
  await page.setInputFiles('#import-file', exported.file);
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Imported: ${n}`, SAVE_NAME, {
    timeout: 10000,
  });
  await waitOwn(1);
  const imported = await ownRow('the save list does not show the import once');
  if (!imported.text.includes(`turn ${played.turn}`)) {
    throw new Error(`the save list does not show the import with its turn: ${JSON.stringify(imported.text)}`);
  }
  const again = await exportOne(imported.id);
  if (!again.bytes.equals(exported.bytes)) throw new Error('the imported save exports as different bytes');
  if (keepExport) {
    fs.mkdirSync(keepExport, { recursive: true });
    fs.copyFileSync(exported.file, path.join(keepExport, `${browserName}-${exported.name}`));
  }
  fs.rmSync(tmp, { recursive: true });

  // 5. Load it: the page reloads on the saved game. With the save game dialog option at always
  // (#153), FreeCol's Loading Save game window asks first, single player its one choice.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('freecol.prefs') ?? '{}');
    p.freecol = { ...p.freecol, 'model.option.showSavegameSettings': 2 };
    localStorage.setItem('freecol.prefs', JSON.stringify(p));
  });
  await noDialog();
  await Promise.all([page.waitForURL(/[?&]load=\d+/), page.click(`#saves [data-save="${imported.id}"] [data-load]`)]);
  await page.waitForSelector('[data-loading-save]', { timeout: 60000 });
  const asked = await page.textContent('[data-loading-save]');
  if (!asked?.includes(`${SAVE_NAME}: turn ${played.turn}`)) {
    throw new Error(`the Loading Save game window does not name the save: ${JSON.stringify(asked)}`);
  }
  await page.click('[data-load-ok]');
  await finished();
  const loaded = await view();
  if (loaded.turn !== played.turn || !loaded.ourTurn || loaded.activeUnit?.id !== active) {
    throw new Error(
      `the loaded game is at turn ${loaded.turn} with active unit ${loaded.activeUnit?.id}` +
        ` (ourTurn ${loaded.ourTurn}); saved at turn ${played.turn} with ${active}`,
    );
  }
  await shot();

  // 6. Play a turn in the loaded game.
  const next = await endTurn();
  if (next.turn === played.turn) throw new Error('the loaded game did not go on');
  return { saved: played.turn, loaded: loaded.turn, active, next: next.turn };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage();
  const errors = collectPageErrors(page);
  const t = Date.now();
  let line;
  try {
    const r = await run(
      page,
      `${server.url}?skipstart`,
      () => page.screenshot({ path: path.join(dist, `../.cache/saves-${name}.png`) }),
      name,
    );
    line = `ok: saved at turn ${r.saved}, exported, deleted and imported, loaded at turn ${r.loaded} with ${r.active}, played on to turn ${r.next}`;
  } catch (ex) {
    failed = true;
    line = `failed: ${await diagnose(ex)}`;
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
