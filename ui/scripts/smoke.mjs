// Smoke test of the built site: serves dist/ statically under a sub-path, as
// GitHub Pages does, loads it in each browser and waits for window.fcResult.
// Exits non-zero unless every browser finishes the game, fetching the data
// bundle once. The page's dialogs are answered as scripts/dialogs.mjs says.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs [--browsers chromium,firefox] [--autoplay N] [--query preset=NAME]
import path from 'node:path';
import { browserNames, collectPageErrors, opt, playwright, waitForResult } from './common.mjs';
import { answerDialogs } from './dialogs.mjs';
import { dist, serveDist } from './serve-dist.mjs';

const browsers = browserNames();
const autoplay = opt('autoplay', '10');
const timeout = Number(opt('timeout', '900')) * 1000;
const server = await serveDist();
/** More page parameters, e.g. preset=dutch-small to start from a preset. */
const query = opt('query', '');
const url = `${server.url}?autoplay=${autoplay}${query ? `&${query}` : ''}`;

let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  server.resetDataFetches();
  const t = Date.now();
  let result;
  try {
    await page.goto(url);
    result = await waitForResult(page, timeout);
    await page.screenshot({ path: path.join(dist, `../.cache/smoke-${name}.png`) });
  } catch (ex) {
    result = { status: 'failed', error: String(ex) };
  }
  await browser.close();
  const ok = result.status === 'finished' && result.rounds.length === Number(autoplay) && server.dataFetches() === 1;
  failed ||= !ok;
  console.log(
    `${name} ${browser.version()}: ${result.status}${result.error ? ': ' + result.error : ''}, ` +
      `${result.rounds?.length ?? 0} rounds, turn ${result.turn ?? '-'}, renderer ${result.renderer ?? '-'}, ` +
      `data fetched ${server.dataFetches()}x, ` +
      `${((Date.now() - t) / 1000).toFixed(1)} s${errors.length ? ', page errors: ' + errors.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
