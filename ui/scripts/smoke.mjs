// Smoke test of the built site: serves dist/ statically under a sub-path, as
// GitHub Pages does, loads it in each browser and waits for window.fcResult.
// Exits non-zero unless every browser finishes the game, fetching the data
// bundle once. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs [--browsers chromium,firefox] [--autoplay N]
import path from 'node:path';
import { createRequire } from 'node:module';
import { dist, serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const browsers = opt('browsers', 'chromium,firefox').split(',');
const autoplay = opt('autoplay', '10');
const timeout = Number(opt('timeout', '900')) * 1000;
const server = await serveDist();
const url = `${server.url}?autoplay=${autoplay}`;

let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  server.resetDataFetches();
  const t = Date.now();
  let result;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.fcResult, null, { timeout });
    result = await page.evaluate(() => window.fcResult);
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
