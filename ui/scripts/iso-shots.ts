// Whole-page screenshots of the Isometric map at some spots of a big revealed map (preset pan-large), and of a new
// game's start (the fog edge), saved as .cache/dialog-shots/iso-<label>-<browser>-<spot>.png (#529). DIST_DIR picks the
// built site (default dist), to compare one build's drawing with another's.
//   DEV_VARIANT=web [DIST_DIR=.cache/dist-base] ./dev.sh node ui/scripts/iso-shots.ts --label after [--spots 100,60;60,40]
import fs from 'node:fs';
import path from 'node:path';
import { browserNames, opt, playwright, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const label = opt('label', 'shot');
const spots = opt('spots', '100,60;60,40;140,80;40,90')
  .split(';')
  .map((s) => s.split(',').map(Number) as [number, number]);
const out = path.resolve(import.meta.dirname, '../../.cache/dialog-shots');
fs.mkdirSync(out, { recursive: true });
const server = await serveDist();
const still = () =>
  localStorage.setItem('freecol.prefs', JSON.stringify({ freecol: { 'model.option.useTerrainAnimations': false } }));

for (const name of browserNames('chromium')) {
  const browser = await playwright[name].launch();
  for (const preset of ['pan-large', null]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await answerDialogs(page);
    page.on('pageerror', (e) => console.log(`${name}: page error: ${e}`));
    await page.addInitScript(still);
    await page.goto(`${server.url}?skipstart${preset ? `&preset=${preset}` : ''}`);
    const ready = await waitForResult(page, 240000);
    if (ready.status === 'failed') throw new Error(`${name}: the game did not start: ${ready.error}`);
    await page.waitForTimeout(3000);
    for (const spot of preset ? spots : [null]) {
      if (spot) {
        await page.evaluate(([x, y]) => (window as any).fcReveal(x, y), spot);
        await page.waitForTimeout(1500);
      }
      await page.mouse.move(0, 0);
      const file = path.join(out, `iso-${label}-${name}-${spot ? spot.join('_') : 'start'}.png`);
      fs.writeFileSync(file, await page.screenshot());
      console.log(path.relative(process.cwd(), file));
    }
    await page.close();
  }
  await browser.close();
}
server.close();
