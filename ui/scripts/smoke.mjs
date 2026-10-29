// Smoke test of the built site: serves dist/ statically under a sub-path, as
// GitHub Pages does, loads it in each browser and waits for window.fcResult.
// Exits non-zero unless every browser finishes the game, fetching the data
// bundle once. Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/smoke.mjs [--browsers chromium,firefox] [--autoplay N]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwright = require('playwright'); // global install, found via NODE_PATH
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const browsers = opt('browsers', 'chromium,firefox').split(',');
const autoplay = opt('autoplay', '10');
const timeout = Number(opt('timeout', '900')) * 1000;
const dist = path.resolve(import.meta.dirname, '../../dist');
const base = '/freecol-online/';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
let dataFetches = 0;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/\/assets\/data-[^/]*\.json$/.test(name)) dataFetches++;
  if (!name.startsWith(base)) return res.writeHead(404).end();
  const file = path.join(dist, path.normalize(name.slice(base.length) || 'index.html'));
  if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}${base}?autoplay=${autoplay}`;

let failed = false;
for (const name of browsers) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  dataFetches = 0;
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
  const ok = result.status === 'finished' && result.rounds.length === Number(autoplay) && dataFetches === 1;
  failed ||= !ok;
  console.log(
    `${name} ${browser.version()}: ${result.status}${result.error ? ': ' + result.error : ''}, ` +
      `${result.rounds?.length ?? 0} rounds, turn ${result.turn ?? '-'}, renderer ${result.renderer ?? '-'}, ` +
      `data fetched ${dataFetches}x, ` +
      `${((Date.now() - t) / 1000).toFixed(1)} s${errors.length ? ', page errors: ' + errors.join('; ') : ''}`,
  );
}
server.close();
process.exit(failed ? 1 : 0);
