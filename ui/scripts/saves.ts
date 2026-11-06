// Saves and loads a game in the built site, through the page's own side panel
// (#68, #69): start a game, play a turn, save it under a name, reload the page
// (a new game starts, and the save is in the list from IndexedDB), export the
// save as a file, delete it, import the file again (a file that is not a save is
// refused), check the export is byte for byte the import, load the save, check
// it comes back at the saved turn with the saved active unit and the player's
// turn (through FreeCol's Loading Save game window), and play another turn, then
// import and load a save that TeaVM's ZipFile failed on (#31). The turn autosaves FreeCol makes as each turn
// begins are checked after the first turn. The page's autosaves sit in the list beside
// the script's save, so the script finds its own row by name. Exits non-zero
// unless every browser gets there. The page's dialogs are answered as scripts/dialogs.ts says.
// Chromium has the File System Access API, so its export goes through the save picker (#274); Playwright
// cannot answer that picker, so a stand-in takes the name suggested and keeps what is written to it.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/saves.ts [--browsers chromium,firefox] [--keep-export DIR]
// --keep-export copies each browser's exported .fsg to DIR (for tools/desktop-check.sh).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, setStep, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';
import type { Page } from 'playwright-core';

const browsers = browserNames();
const keepExport = opt('keep-export', '');
const SAVE_NAME = 'script save';
/** Whether a download is the file named: WebKit's downloads put underscores for the spaces. */
const isFile = (got: string, want: string) => got.replaceAll('_', ' ') === want;
/** A save TeaVM's ZipFile could not read (#31): its deflate data needs the dummy byte zlib wants after it. */
const DUMMY_BYTE_SAVE = path.join(import.meta.dirname, 'fixtures/zip-needs-dummy-byte.fsg');

/** Play with the page of one browser; returns what was checked. */
async function run(page: Page, url: string, shot: () => Promise<unknown>, browserName: string) {
  const picker = browserName === 'chromium';
  if (picker) {
    await page.addInitScript(() => {
      window.__files = {};
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: ({ suggestedName }: { suggestedName: string }) =>
          Promise.resolve({
            name: suggestedName,
            createWritable: () => {
              const parts: number[] = [];
              return Promise.resolve({
                write: (b: Uint8Array) => void parts.push(...b),
                close: () => void (window.__files![suggestedName] = parts),
              });
            },
          }),
      });
    });
  }
  // Keep the latest map view the client Engine sends, as play.ts does, and when the save list last
  // changed and when the last map view of the player's turn came, for listSettled.
  await page.addInitScript(() => {
    let inner: ((name: string, detail: string) => unknown) | undefined;
    window.__maps = 0;
    window.__listAt = 0;
    window.__ourMapAt = -Infinity;
    let rows = '';
    setInterval(() => {
      const now = [...document.querySelectorAll('#saves [data-save]')].map((r) => r.getAttribute('data-save')).join();
      if (now !== rows) {
        rows = now;
        window.__listAt = performance.now();
      }
    }, 50);
    Object.defineProperty(window, 'fcClientEvent', {
      configurable: true,
      get: () => inner,
      set: (f: (name: string, detail: string) => unknown) => {
        inner = (name: string, detail: string) => {
          if (name === 'map' || name === 'gameStarted') {
            window.__map = JSON.parse(detail);
            window.__maps++;
            if (window.__map.ourTurn) window.__ourMapAt = performance.now();
          }
          return f(name, detail);
        };
      },
    });
  });
  await answerDialogs(page);

  const view = () => page.evaluate(() => window.__map);
  const noDialog = () =>
    page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, {
      timeout: 10000,
      label: 'no dialog is open',
    });
  const finished = async () => {
    const r = await waitForResult(page, 300000);
    if (r.status !== 'finished') throw new Error(`the page did not start a game: ${JSON.stringify(r)}`);
    // The first map view and the active unit have arrived.
    await page.waitForFunction(() => window.__map?.ourTurn, null, {
      timeout: 60000,
      label: "the first map view on the player's turn",
    });
  };
  const endTurn = async () => {
    const turn = (await view()).turn;
    await noDialog();
    await page.keyboard.press('Enter');
    await page.waitForFunction((t: string) => window.__map.turn !== t && window.__map.ourTurn, turn, {
      timeout: 120000,
      label: 'the next turn starts and play is back with the human',
    });
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
  const ownRow = async (what: string) => {
    const own = await ownRows();
    if (own.length !== 1) throw new Error(`${what}: ${JSON.stringify(await rows())}`);
    return own[0]!;
  };
  /** Wait until the list shows `count` rows of the script's save. */
  const waitOwn = (count: number) =>
    page.waitForFunction(
      ([n, c]: [string, number]) =>
        [...document.querySelectorAll('#saves [data-save]')].filter((r) => r.textContent?.startsWith(`${n} |`))
          .length === c,
      [SAVE_NAME, count] as [string, number],
      { timeout: 10000, label: `the save list shows ${count} rows of the script's save` },
    );

  /**
   * Waits until no autosave is on its way to move the save list's rows (#244). The page autosaves
   * AUTOSAVE_MS (1.5 s, src/main.tsx) after each map view of the player's turn and lists the save at
   * the top, so every row under it moves down a row. A click on a row's button just then can press
   * one row and let go over another, which is no click at all: the export's download never came.
   * Settled is: the list has changed since that autosave was due, and then not for two seconds.
   */
  const listSettled = () =>
    page.waitForFunction(
      () => window.__listAt > window.__ourMapAt + 1500 && performance.now() - window.__listAt > 2000,
      null,
      { timeout: 30000, polling: 100, label: 'the save list has its autosave and stops moving' },
    );
  /** Clicks a button of a save's row once the list holds still. */
  const clickRow = async (id: string | null, button: string) => {
    await listSettled();
    await page.click(`#saves [data-save="${id}"] [${button}]`);
  };

  // 1. A new game, one turn played.
  setStep('1. a new game, one turn played');
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
    'Autosave-before-last-turn': Number(played.turn) - 1,
    [`Autosave-${played.turnLabel}`]: played.turn,
  };
  await page
    .waitForFunction(
      (want) =>
        Object.entries(want).every(([n, t]) =>
          [...document.querySelectorAll('#saves [data-save]')].some(
            (r) => r.textContent?.startsWith(`${n} |`) && r.textContent.includes(`turn ${String(t)} `),
          ),
        ),
      autosaves,
      { timeout: 30000, label: 'the turn autosaves are listed' },
    )
    .catch(async () => {
      throw new Error(
        `the save list lacks the turn autosaves ${JSON.stringify(autosaves)}: ${JSON.stringify(await rows())}`,
      );
    });

  // 2. Save it.
  setStep('2. save the game');
  await page.fill('#save-name', SAVE_NAME);
  await page.click('button[data-command=save]');
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Saved: ${n}`, SAVE_NAME, {
    timeout: 60000,
    label: 'the page says the game is saved',
  });
  await waitOwn(1);
  const row = await ownRow('the save list does not show the save once');
  if (!row.text.includes(`turn ${played.turn}`)) {
    throw new Error(`the save list does not show the save: ${JSON.stringify(row.text)}`);
  }

  // 2b. Without a save picker (Firefox), Game > Save keeps the save in the browser, says so, and its Save and
  // Download button hands a copy to the browser as a download too.
  if (!picker) {
    setStep('2b. Game > Save, Save and Download');
    const DOWNLOAD_NAME = 'script download';
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+s');
    await page.waitForSelector('#save-game [data-save-where]', { timeout: 10000 });
    await page.fill('#save-game [data-save-name]', DOWNLOAD_NAME);
    const downloaded = page.waitForEvent('download', { timeout: 60000, label: 'the download of Save and Download' });
    downloaded.catch(() => {});
    await page.click('#save-game [data-save-download]');
    const download = await downloaded;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'saves-')), download.suggestedFilename());
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    if (!isFile(download.suggestedFilename(), `${DOWNLOAD_NAME}.fsg`) || bytes.subarray(0, 2).toString() !== 'PK') {
      throw new Error(`Save and Download gave ${download.suggestedFilename()}, ${bytes.length} bytes, not a save`);
    }
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('#saves [data-save]')].some((r) => r.textContent?.startsWith(`${n} |`)),
      DOWNLOAD_NAME,
      { timeout: 10000, label: 'the save list shows the downloaded save' },
    );
  }

  // 3. Reload: a new game starts, and the save is still listed.
  setStep('3. reload: a new game, the save still listed');
  await page.goto(url);
  await finished();
  await waitOwn(1);
  const listed = await ownRow('the save list after a reload');
  const fresh = await view();
  if (fresh.turn === played.turn) throw new Error('the reloaded page is not a new game');

  // 4. Export it, delete it, import the file, and refuse a file that is no save.
  setStep('4. export, delete and import the save');
  /**
   * Exports a save. The click, the page's own word on the export and the browser's download are waited
   * for one after another, so a timeout says which of them did not happen (#244): the page writes its
   * note just after it hands the file to the browser. In Chromium the file is the one the stand-in save
   * picker was given.
   */
  const exportOne = async (id: string | null, what: string) => {
    setStep(`4. export ${what}`);
    if (picker) await page.evaluate(() => (window.__files = {}));
    const downloaded = picker
      ? Promise.resolve(null)
      : page.waitForEvent('download', { timeout: 30000, label: `the browser's download of ${what}` });
    // Rejected before it is awaited (a failed click, say), it must not be an unhandled rejection.
    downloaded.catch(() => {});
    await clickRow(id, 'data-export');
    await page.waitForFunction(
      () => /^Export(ed| failed): /.test(document.querySelector('#save-note')?.textContent ?? ''),
      null,
      {
        timeout: 10000,
        label: `the page says it exported ${what}`,
      },
    );
    const note = await page.textContent('#save-note');
    if (!note?.startsWith('Exported: ')) throw new Error(`the page did not export ${what}: ${note}`);
    const download = await downloaded;
    if (!download) {
      const files = Object.entries((await page.evaluate(() => window.__files)) ?? {});
      if (files.length !== 1) throw new Error(`the save picker was written ${files.length} files for ${what}`);
      const [name, bytes] = files[0];
      const file = path.join(tmp, name);
      fs.writeFileSync(file, Uint8Array.from(bytes));
      return { file, name, bytes: fs.readFileSync(file) };
    }
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    return { file, name: download.suggestedFilename(), bytes: fs.readFileSync(file) };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saves-'));
  const exported = await exportOne(listed.id, 'the save');
  if (!isFile(exported.name, `${SAVE_NAME}.fsg`) || exported.bytes.subarray(0, 2).toString() !== 'PK') {
    throw new Error(`the export is ${exported.name}, ${exported.bytes.length} bytes, not a zip named for the save`);
  }
  setStep('4. delete the save, import a file that is no save, then the export');
  await clickRow(listed.id, 'data-delete');
  await waitOwn(0);
  const junk = path.join(tmp, 'junk.fsg');
  fs.writeFileSync(junk, 'this is not a save');
  await page.setInputFiles('#import-file', junk);
  await page.waitForFunction(
    () => document.querySelector('#save-note')?.textContent?.startsWith('Import failed: '),
    null,
    { timeout: 10000, label: 'the page refuses the file that is no save' },
  );
  if ((await ownRows()).length !== 0) throw new Error('a file that is no save was imported');
  await page.setInputFiles('#import-file', exported.file);
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Imported: ${n}`, SAVE_NAME, {
    timeout: 10000,
    label: 'the page says it imported the export',
  });
  await waitOwn(1);
  const imported = await ownRow('the save list does not show the import once');
  if (!imported.text.includes(`turn ${played.turn}`)) {
    throw new Error(`the save list does not show the import with its turn: ${JSON.stringify(imported.text)}`);
  }
  const again = await exportOne(imported.id, 'the imported save');
  setStep('4. compare the exports');
  if (!again.bytes.equals(exported.bytes)) throw new Error('the imported save exports as different bytes');
  if (keepExport) {
    fs.mkdirSync(keepExport, { recursive: true });
    fs.copyFileSync(exported.file, path.join(keepExport, `${browserName}-${exported.name}`));
  }
  fs.rmSync(tmp, { recursive: true });

  // 5. Load it: the page reloads on the saved game. With the save game dialog option at always
  // (#153), FreeCol's Loading Save game window asks first, single player its one choice.
  setStep('5. load the save');
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('freecol.prefs') ?? '{}');
    p.freecol = { ...p.freecol, 'model.option.showSavegameSettings': 2 };
    localStorage.setItem('freecol.prefs', JSON.stringify(p));
  });
  await noDialog();
  await listSettled();
  await Promise.all([page.waitForURL(/[?&]load=\d+/), page.click(`#saves [data-save="${imported.id}"] [data-load]`)]);
  await page.waitForSelector('[data-loading-save]', { timeout: 60000, label: 'the Loading Save game window' });
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
  setStep('6. play a turn in the loaded game');
  const next = await endTurn();
  if (next.turn === played.turn) throw new Error('the loaded game did not go on');

  // 7. A save whose deflate data ends where TeaVM's ZipFile failed with
  // EOFException in every browser (#31) must load.
  setStep('7. import and load the fixture save');
  await noDialog();
  await page.setInputFiles('#import-file', DUMMY_BYTE_SAVE);
  const fixture = path.basename(DUMMY_BYTE_SAVE, '.fsg');
  await page.waitForFunction((n) => document.querySelector('#save-note')?.textContent === `Imported: ${n}`, fixture, {
    timeout: 10000,
    label: 'the page says it imported the fixture save',
  });
  const fixtureId = await page.evaluate(
    (n) =>
      [...document.querySelectorAll('#saves [data-save]')]
        .find((r) => r.textContent?.startsWith(`${n} |`))
        ?.getAttribute('data-save'),
    fixture,
  );
  if (!fixtureId) throw new Error(`the imported ${fixture} is not in the save list: ${JSON.stringify(await rows())}`);
  await listSettled();
  await Promise.all([page.waitForURL(/[?&]load=\d+/), page.click(`#saves [data-save="${fixtureId}"] [data-load]`)]);
  await page.waitForSelector('[data-loading-save]', {
    timeout: 60000,
    label: 'the Loading Save game window for the fixture save',
  });
  await page.click('[data-load-ok]');
  await finished();
  return { saved: played.turn, loaded: loaded.turn, active, next: next.turn };
}

const server = await serveDist();
let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage();
  const errors = collectPageErrors(page);
  const t = Date.now();
  let line: string;
  try {
    const r = await run(
      page,
      `${server.url}?skipstart`,
      () => page.screenshot({ path: path.join(dist, `../.cache/saves-${name}.png`) }),
      name,
    );
    line = `ok: saved at turn ${r.saved}, exported, deleted and imported, loaded at turn ${r.loaded} with ${r.active}, played on to turn ${r.next}, fixture save loaded`;
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
