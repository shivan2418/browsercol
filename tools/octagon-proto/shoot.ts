// Throwaway (#376): serves the repo, opens tools/octagon-proto/index.html for each
// variant at 100% and 200% display scaling, in Chromium and Firefox, and saves a
// screenshot of each to tools/octagon-proto/shots/<variant>-<zoom>x-<browser>.png.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node tools/octagon-proto/shoot.ts [variants...]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { playwright } from '../../ui/scripts/common.ts';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(import.meta.dirname, 'shots');
mkdirSync(out, { recursive: true });
const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url!, 'http://x').pathname));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = (server.address() as { port: number }).port;

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['now', 'carved', 'pile', 'drawn', 'title'];
for (const name of ['chromium', 'firefox'] as const) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage({ viewport: { width: 2600, height: 1200 } });
  for (const v of variants)
    for (const zoom of [1, 2]) {
      await page.goto(`http://localhost:${port}/tools/octagon-proto/index.html?v=${v}&zoom=${zoom}`);
      await page.waitForSelector('body[data-ready]');
      await page.locator('.page').screenshot({ path: path.join(out, `${v}-${zoom}x-${name}.png`) });
    }
  await browser.close();
}
server.close();
console.log('shots in', out);
