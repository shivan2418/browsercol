// Shoots the "Colony octagons" story (src/colony-octagons.stories.tsx, #376) in each font treatment, in the
// parchment and dark themes, at 100% and 200% display scaling, in Chromium and Firefox, to
// .cache/octagon-shots/<treatment>-<theme>-<scale>x-<browser>.png. Build Storybook first, then shoot in the web image:
//   ./dev.sh -C ui pnpm exec storybook build -o /work/.cache/storybook --quiet
//   DEV_VARIANT=web ./dev.sh node ui/scripts/octagon-shots.ts [treatments...]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { playwright } from './common.ts';

const root = path.resolve(import.meta.dirname, '../../.cache/storybook');
const out = path.resolve(import.meta.dirname, '../../.cache/octagon-shots');
mkdirSync(out, { recursive: true });
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url!, 'http://x').pathname));
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(0);
const port = (server.address() as { port: number }).port;

const treatments = process.argv.slice(2).length ? process.argv.slice(2) : ['now', 'cinzel', 'ink', 'outline', 'shadow'];
for (const name of ['chromium', 'firefox'] as const) {
  const browser = await playwright[name].launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  for (const treatment of treatments)
    for (const theme of ['parchment', 'dark'])
      for (const scale of [1, 2]) {
        const args = `treatment:${treatment};theme:${theme};scale:${scale}`;
        await page.goto(`http://localhost:${port}/iframe.html?id=colony-octagons--numbers&viewMode=story&args=${args}`);
        await page.waitForSelector('.octagon-sheet');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const file = `${treatment}-${theme}-${scale}x-${name}.png`;
        await page.locator('.octagon-sheet').screenshot({ path: path.join(out, file) });
      }
  await browser.close();
}
server.close();
console.log('shots in', out);
