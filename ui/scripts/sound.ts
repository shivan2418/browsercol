// Browser check that the first sale in Europe is heard (#391): the sound effect files are fetched once the game
// starts, so the sale's sound plays from memory with no download, and the audio element fires `playing` for it.
// Headless browsers have no speakers: the HTMLMediaElement is instrumented instead.
// Run in the web image (after ./build.sh):
//   DEV_VARIANT=web ./dev.sh node ui/scripts/sound.ts [--browsers chromium,firefox]
import { browserNames, collectPageErrors, diagnose, launchBrowser } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const browsers = browserNames('chromium');
const server = await serveDist();
const timeout = 600_000;

let failed = false;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  failed ||= !ok;
};

for (const name of browsers) {
  const browser = await launchBrowser(name);
  const page = await browser.newPage();
  await answerDialogs(page);
  const errors = collectPageErrors(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.ogg')) requests.push(r.url().split('/').pop()!);
  });
  try {
    await page.addInitScript(() => {
      const log: string[] = ((window as unknown as { __played: string[] }).__played = []);
      const proto = HTMLMediaElement.prototype;
      const play = Reflect.get(proto, 'play') as typeof proto.play;
      const seen = new WeakSet<object>();
      proto.play = function (this: HTMLMediaElement) {
        if (!seen.has(this)) {
          seen.add(this);
          this.addEventListener('playing', () => log.push(this.src));
        }
        return play.call(this);
      };
    });
    await page.goto(`${server.url}?preset=dutch-small&debug&autoplay=0`);
    await page.waitForFunction(() => window.fcResult?.status === 'finished', null, { timeout });
    await page.fill('input[aria-label="Gold"]', '5000');
    await page.click('button[data-debug="gold"]');
    await page.evaluate(() => (window.__hold = 'europe'));
    await page.click('button[data-command=showEurope]');
    const panel = page.locator('[role=dialog][data-kind=europe]');
    await panel.waitFor({ timeout: 10_000 });
    await panel.locator('button[data-europe=purchase]').click();
    await panel.locator('[data-shop=purchase] [data-offer="model.unit.caravel"]').click();
    await panel.locator('[data-list=inPort] [data-unit]').first().waitFor({ timeout: 60_000 });
    const shop = panel.locator('[data-shop]');
    if ((await shop.count()) > 0) await shop.locator('button.close').click();

    // Every effect file is fetched before the first trade.
    await page.waitForTimeout(2000);
    const before = new Set(requests);
    check(
      `${name}: the sell and load sounds are fetched before any trade`,
      before.has('sell.ogg') && before.has('load.ogg'),
      [...before].join(','),
    );

    const played = () => page.evaluate(() => (window as unknown as { __played: string[] }).__played.slice());
    await panel.locator('[data-list=market] [data-goods]').first().click();
    await panel.locator('[data-list=cargo] [data-cargo=goods]').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    // The sources are blob URLs, so a sound is told by its order: the purchase's sound came first.
    const playsBefore = (await played()).length;
    await panel.locator('[data-list=cargo] [data-cargo=goods]').first().click();
    await panel.locator('[data-list=cargo] [data-cargo=goods]').first().waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForTimeout(1500);
    const log = await played();
    check(`${name}: the first sale's sound plays`, log.length === playsBefore + 1, log.join(' | '));
    check(
      `${name}: it plays from the preloaded file, not a download`,
      log.some((s) => s.startsWith('blob:')),
      log.join(' | '),
    );
    check(`${name}: the sale fetches no sound file`, requests.length === before.size, requests.join(','));
    check(`${name}: no page errors`, errors.length === 0, errors.join('; '));
  } catch (ex) {
    check(`${name}: the first sale's sound`, false, await diagnose(ex));
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
