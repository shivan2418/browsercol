// Smoke test of the built site: serves dist/ statically under a sub-path, as
// GitHub Pages does, loads it in each browser and waits for window.fcResult.
// The game starts from the start screen: the player picks a nation and a
// difficulty level (the first run takes what the screen offers first), and
// every Classic nation is then started in turn and must be the player's. Exits non-zero
// unless every browser finishes the game, fetching the data bundle once.
// The page's dialogs are answered as scripts/dialogs.mjs says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs [--browsers chromium,firefox] [--autoplay N] [--query preset=NAME]
import path from 'node:path';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.mjs';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

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
async function startFromScreen(page, nation, level, edits = false) {
  await page.waitForSelector('[data-start]', { timeout: 60000 });
  if (nation) await page.click(`[data-nation="${nation}"]`);
  if (level) await page.selectOption('[data-difficulty]', level);
  if (edits) {
    // The option editor: a difficulty option and a game option, changed before the start.
    await page.click('[data-customize=difficulty] summary');
    await page.fill(`[data-customize=difficulty] [data-option="${LAND_PRICE}"] input`, '123');
    await page.click('[data-customize=game] summary');
    await page.click('[data-customize=game] [data-option="model.option.fogOfWar"] input');
    // The map generator options: a smaller map than Classic's 40x100.
    await page.click('[data-customize=map] summary');
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
  server.resetDataFetches();
  const t = Date.now();
  let result;
  try {
    await page.goto(url);
    if (screen) await startFromScreen(page);
    result = await waitForResult(page, timeout);
    await page.screenshot({ path: path.join(dist, `../.cache/smoke-${name}.png`) });
  } catch (ex) {
    result = { status: 'failed', error: await diagnose(ex) };
  }
  const fetches = server.dataFetches();
  // Each Classic nation, started from the start screen with a difficulty level, is the player's.
  const nations = [];
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
  await browser.close();
  const ok =
    result.status === 'finished' &&
    result.rounds.length === Number(autoplay) &&
    fetches === 1 &&
    nations.every((n) => n.endsWith(' ok'));
  failed ||= !ok;
  console.log(
    `${name} ${browser.version()}: ${result.status}${result.error ? ': ' + result.error : ''}, ` +
      `${result.rounds?.length ?? 0} rounds, turn ${result.turn ?? '-'}, renderer ${result.renderer ?? '-'}, ` +
      `data fetched ${fetches}x, ` +
      (screen ? `start screen: ${nations.join(', ')}, ` : '') +
      `${((Date.now() - t) / 1000).toFixed(1)} s${errors.length ? ', page errors: ' + errors.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
