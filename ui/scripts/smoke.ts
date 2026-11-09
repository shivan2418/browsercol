// Smoke test of the built site: serves dist/ statically under a sub-path, as
// GitHub Pages does, loads it in each browser and waits for window.fcResult.
// The game starts from the start screen: the player picks a nation and a
// difficulty level (the first run takes what the screen offers first), and
// every Classic nation is then started in turn and must be the player's, and a game in German
// (FreeCol's language option) shows FreeCol's text in German. Exits non-zero
// unless every browser finishes the game, fetching the data bundle once, and
// plays sound: the start screen's introduction music and the nation's, which
// the Engine asks for as the game starts.
// The page's dialogs are answered as scripts/dialogs.ts says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.ts [--browsers chromium,firefox] [--autoplay N] [--query preset=NAME] [--url https://browsercol.com/play/]
import fs from 'node:fs';
import path from 'node:path';
import {
  browserNames,
  collectPageErrors,
  diagnose,
  launchBrowser,
  opt,
  waitForResult,
  type FcResult,
} from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { dist, serveDist } from './serve-dist.ts';
import type { Page, Request } from 'playwright-core';

const browsers = browserNames();
const autoplay = opt('autoplay', '10');
const timeout = Number(opt('timeout', '900')) * 1000;
const server = await serveDist();
/** More page parameters, e.g. preset=dutch-small to start from a preset. */
const query = opt('query', '');
const url = `${server.url}?autoplay=${autoplay}${query ? `&${query}` : ''}`;
/** A preset or a skipped start screen starts the game by itself. */
const screen = !/(^|&)(preset|skipstart)=?/.test(query);
/** The Classic nations the start screen must give the player, and a difficulty level to try with each. */
const NATIONS = [
  ['model.nation.dutch', 'model.difficulty.veryEasy'],
  ['model.nation.french', 'model.difficulty.easy'],
  ['model.nation.english', 'model.difficulty.hard'],
  ['model.nation.spanish', 'model.difficulty.veryHard'],
];

const LAND_PRICE = 'model.option.landPriceFactor';
const MAP_WIDTH = 'model.option.mapWidth';
const MAP_HEIGHT = 'model.option.mapHeight';

/** Pick on the start screen (nothing picked keeps what it shows first) and start the game. */
async function startFromScreen(page: Page, nation?: string, level?: string, edits = false) {
  await page.waitForSelector('[data-start]', { timeout: 60000 });
  if (nation) await page.click(`[data-nation="${nation}"]`);
  if (level) {
    // A drop-down list (src/controls.tsx): open it, then pick the entry by its value.
    await page.click('[data-difficulty]');
    await page.click(`.ui-select-item[data-value="${level}"]`);
  }
  if (edits) {
    // The option editor: a difficulty option and a game option, changed before the start.
    await page.click('[data-customize-tab=difficulty]');
    await page.fill(`[data-customize=difficulty] [data-option="${LAND_PRICE}"] input`, '123');
    await page.click('[data-customize-tab=game]');
    await page.click('[data-customize=game] [data-option="model.option.fogOfWar"] input');
    // The map generator options: a smaller map than Classic's 40x100.
    await page.click('[data-customize-tab=map]');
    await page.fill(`[data-customize=map] [data-option="${MAP_WIDTH}"] input`, '30');
    await page.fill(`[data-customize=map] [data-option="${MAP_HEIGHT}"] input`, '40');
  }
  await page.click('[data-start]');
}

let failed = false;
for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  // Music is off until the player turns it on (#318), and its files are not fetched while it is (#347): the sound check needs it on.
  await page.addInitScript(() => localStorage.setItem('freecol.prefs', JSON.stringify({ muteMusic: false })));
  server.watch?.(page);
  server.resetDataFetches();
  /** The audio files the page asked for, under audio/. */
  const audio = new Set<string>();
  const onRequest = (r: Request) => {
    const m = /\/audio\/(.+\.ogg)$/.exec(r.url());
    if (m) audio.add(m[1]!);
  };
  page.on('request', onRequest);
  const t = Date.now();
  let result: FcResult;
  try {
    await page.goto(url);
    if (screen) await startFromScreen(page);
    result = await waitForResult(page, timeout);
    fs.mkdirSync(path.join(dist, '../.cache'), { recursive: true });
    await page.screenshot({ path: path.join(dist, `../.cache/smoke-${name}.png`) });
  } catch (ex) {
    result = { status: 'failed', error: await diagnose(ex) };
  }
  const fetches = server.dataFetches();
  page.off('request', onRequest);
  const sounds = screen
    ? ['base/resources/sound/intro.ogg', 'default/resources/sound/intro/generic.ogg']
    : ['default/resources/sound/intro/generic.ogg'];
  const unheard = sounds.filter((f) => !audio.has(f));
  // Each Classic nation, started from the start screen with a difficulty level, is the player's.
  const nations: string[] = [];
  if (screen) {
    for (const [nation, level] of NATIONS) {
      try {
        await page.goto(`${server.url}?autoplay=0`);
        await startFromScreen(page, nation, level, nation === 'model.nation.french');
        const r = await waitForResult(page, timeout);
        const sent = r.choice ? JSON.parse(r.choice) : {};
        nations.push(
          r.status === 'finished' &&
            r.nation === nation &&
            sent.difficulty === level &&
            (nation !== 'model.nation.french' ||
              (sent.options?.[LAND_PRICE] === 123 &&
                sent.options?.['model.option.fogOfWar'] === false &&
                r.mapSize?.join('x') === '30x40'))
            ? `${nation.split('.').pop()} ok`
            : `${nation} FAILED (${r.status}${r.error ? ': ' + r.error : ''}, player ${r.nation}, sent ${r.choice})`,
        );
      } catch (ex) {
        nations.push(`${nation} FAILED (${await diagnose(ex)})`);
      }
    }
  }
  // FreeCol's language option (#151): German strings on the start screen and from the client Engine.
  let language = 'German ok';
  let british = 'English (UK) ok';
  if (screen) {
    const german = await browser.newPage();
    await answerDialogs(german);
    try {
      await german.addInitScript(() =>
        localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.languageOption': 'de' } })),
      );
      await german.goto(`${server.url}?autoplay=0`);
      await german.waitForSelector('[data-nation="model.nation.dutch"]', { timeout: 60000 });
      const nation = await german.textContent('label:has([data-nation="model.nation.dutch"]) .name');
      await german.click('[data-start]');
      const r = await waitForResult(german, timeout);
      const units = await german.textContent('body');
      if (!nation!.includes('Niederländisch') || r.status !== 'finished' || !units!.includes('Niederländisch Soldat'))
        language = `German FAILED (${r.status}${r.error ? ': ' + r.error : ''}, start screen ${nation})`;
    } catch (ex) {
      language = `German FAILED (${await diagnose(ex)})`;
    }
    // English (UK), en_GB, a translation with a country: naming it once crashed the Engine in TeaVM's
    // Locale.getDisplayCountry (a lookup in an empty CLDR map divides by zero). A browser set to en-GB picks it.
    const uk = await browser.newPage();
    await answerDialogs(uk);
    try {
      await uk.addInitScript(() =>
        localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.languageOption': 'en_GB' } })),
      );
      await uk.goto(`${server.url}?autoplay=0`);
      await uk.waitForSelector('[data-nation="model.nation.dutch"]', { timeout: 60000 });
      await uk.click('[data-start]');
      const r = await waitForResult(uk, timeout);
      if (r.status !== 'finished') british = `English (UK) FAILED (${r.status}${r.error ? ': ' + r.error : ''})`;
    } catch (ex) {
      british = `English (UK) FAILED (${await diagnose(ex)})`;
    }
  }
  // The Colopedia from the start screen (#206), before any game: nations, then nation types, and the
  // game still starts from the same page afterwards.
  let colopedia = 'Colopedia ok';
  if (screen) {
    // No answerDialogs here: it would close the Colopedia as it opens.
    const pedia = await browser.newPage();
    try {
      await pedia.goto(`${server.url}?autoplay=0`);
      await pedia.click('[data-colopedia=nations]');
      await pedia.waitForSelector('.colopedia [data-entry="model.nation.dutch"]', { timeout: 120000 });
      // The window keeps one width and one height whatever entry is shown (#423), the longest text wrapping in it.
      const size = () =>
        pedia.$eval('.dialog[data-kind=report]', (d) => `${Math.round(d.clientWidth)}x${Math.round(d.clientHeight)}`);
      const entries = await pedia.$$eval('.colopedia [data-entry] button', (b) => b.map((x) => x.textContent));
      const sizes = new Set<string>([await size()]);
      for (let i = 0; i < Math.min(entries.length, 4); i++) {
        await pedia.locator('.colopedia [data-entry] button').nth(i).click();
        sizes.add(await size());
      }
      if (sizes.size !== 1) throw new Error(`the Colopedia's size changes with the entry: ${[...sizes].join(', ')}`);
      await pedia.click('[data-answer=close]');
      await pedia.click('[data-colopedia=nationTypes]');
      await pedia.waitForSelector('.colopedia [data-entry="model.nationType.trade"]', { timeout: 60000 });
      await pedia.click('[data-answer=close]');
      await pedia.click('[data-start]');
      const r = await waitForResult(pedia, timeout);
      if (r.status !== 'finished') colopedia = `Colopedia FAILED (game ${r.status}${r.error ? ': ' + r.error : ''})`;
    } catch (ex) {
      colopedia = `Colopedia FAILED (${await diagnose(ex)})`;
    }
  }
  // The landing page at the site's root (#374): the Play button opens play/ in a new tab, and a root URL with game
  // parameters is forwarded to the game with the same query.
  let landing = 'landing ok';
  if (screen) {
    const lp = await browser.newPage();
    try {
      // Not goto: in Firefox it adds ?renderer=canvas2d, which is a game parameter, so the root would forward.
      await lp.goto('about:blank');
      await lp.evaluate((u) => (location.href = u), server.root);
      const play = await lp.getAttribute('a.play', 'href', { timeout: 30000 });
      const tab = await lp.getAttribute('a.play', 'target');
      await lp.goto(`${server.root}?preset=dutch-small&autoplay=0`);
      await lp.waitForURL(/\/play\/\?preset=dutch-small&autoplay=0/, { timeout: 30000 });
      if (play !== 'play/') landing = `landing FAILED (Play goes to ${play})`;
      else if (tab !== '_blank') landing = `landing FAILED (Play opens in ${tab ?? 'the same tab'})`;
    } catch (ex) {
      landing = `landing FAILED (${await diagnose(ex)})`;
    }
  }
  await browser.close();
  const ok =
    result.status === 'finished' &&
    result.rounds!.length === Number(autoplay) &&
    fetches === 1 &&
    unheard.length === 0 &&
    nations.every((n) => n.endsWith(' ok')) &&
    language.endsWith(' ok') &&
    british.endsWith(' ok') &&
    colopedia.endsWith(' ok') &&
    landing.endsWith(' ok');
  failed ||= !ok;
  console.log(
    `${name} ${browser.version()}: ${result.status}${result.error ? ': ' + result.error : ''}, ` +
      `${result.rounds?.length ?? 0} rounds, turn ${result.turn ?? '-'}, renderer ${result.renderer ?? '-'}, ` +
      `data fetched ${fetches}x, ` +
      `sounds ${unheard.length ? 'MISSING ' + unheard.join(' ') : 'ok'} (${audio.size} files), ` +
      (screen ? `start screen: ${nations.join(', ')}, ${language}, ${british}, ${colopedia}, ${landing}, ` : '') +
      `${((Date.now() - t) / 1000).toFixed(1)} s${errors.length ? ', page errors: ' + errors.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
