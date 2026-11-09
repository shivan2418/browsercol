// Audio loads lazily (#347): the built site's music and sound effects (93 MB of dist/) stay out of the first load.
// A cold browser loads the start screen and then the first turn, twice: with music off (the default,
// #318) and with it on. Nothing may fetch a music file while it is off, only the introduction music may
// before the first turn with it on, and the page must register no service worker, so nothing precaches audio/ (#267, #296).
// Prints the bytes each load took (response headers and bodies, as the browser received them), and the
// requests that were audio.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/audio.ts [--browsers chromium,firefox] [--url https://browsercol.com/]
import type { Page, Response } from 'playwright-core';
import { browserNames, collectPageErrors, diagnose, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { logAudio } from './sound-log.ts';
import { serveDist } from './serve-dist.ts';

const timeout = Number(opt('timeout', '900')) * 1000;
const server = await serveDist();
const url = `${server.url}?autoplay=0`;
const MB = (n: number) => (n / 1048576).toFixed(1);

/** The files the introduction music may be: the start screen's and the nations'. */
const EFFECT = /\/audio\/default\/resources\/sound\/(event|attack)\/[^/]+\.ogg$/;
const INTRO = /\/audio\/(base\/resources\/sound\/intro\.ogg|default\/resources\/sound\/intro\/[^/]+\.ogg)$/;

/** One load of the page: the bytes it took by the start screen, and by the first turn, and the audio it fetched. */
interface Load {
  startScreen: number;
  firstTurn: number;
  audio: string[];
  audioBytes: number;
  workers: number;
  errors: string[];
}

async function load(name: ReturnType<typeof browserNames>[number], music: boolean): Promise<Load> {
  const browser = await launchBrowser(name);
  try {
    const context = await browser.newContext();
    const page: Page = await context.newPage();
    await answerDialogs(page);
    const errors = collectPageErrors(page);
    if (music) {
      await page.addInitScript(() =>
        localStorage.setItem('freecol.prefs', JSON.stringify({ muteMusic: false, muteEffects: false })),
      );
    }
    const sizes: Promise<{ url: string; bytes: number }>[] = [];
    page.on('response', (r: Response) => {
      sizes.push(
        r
          .request()
          .sizes()
          .then(
            (s) => ({ url: r.url(), bytes: s.responseBodySize + s.responseHeadersSize }),
            () => ({ url: r.url(), bytes: 0 }),
          ),
      );
    });
    const total = async () => (await Promise.all(sizes)).reduce((sum, r) => sum + r.bytes, 0);
    await page.goto(url);
    await page.waitForSelector('[data-start]', { timeout: 60000 });
    // The start screen's own music, if it plays, is requested at once: give it time.
    await page.waitForTimeout(3000);
    const startScreen = await total();
    await page.click('[data-start]');
    const result = await waitForResult(page, timeout);
    if (result.status !== 'finished') throw new Error(`game ${result.status}: ${result.error ?? ''}`);
    await page.waitForTimeout(3000);
    const firstTurn = await total();
    const all = await Promise.all(sizes);
    const audio = all.filter((r) => /\/audio\/.+\.(ogg|wav|mp3|flac)$/i.test(r.url));
    const workers = await page.evaluate(async () => {
      const regs = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      const caches_ = 'caches' in self ? await caches.keys() : [];
      return regs.length + caches_.length;
    });
    return {
      startScreen,
      firstTurn,
      audio: audio.map((r) => r.url.replace(/^.*\/audio\//, '')),
      audioBytes: audio.reduce((sum, r) => sum + r.bytes, 0),
      workers: workers + context.serviceWorkers().length,
      errors,
    };
  } finally {
    await browser.close();
  }
}

/**
 * The first sound effect of a session plays (#391): in Europe the player buys a ship and then goods onto it, and the
 * goods' load sound must start a Web Audio source, the first time as the second. Prints the audio log.
 */
async function firstLoadSound(name: ReturnType<typeof browserNames>[number]): Promise<string[]> {
  const browser = await launchBrowser(name);
  try {
    const page = await browser.newPage();
    await answerDialogs(page);
    const lines: string[] = [];
    await logAudio(page, name, (l) => (console.log(l), lines.push(l)));
    await page.goto(`${server.url}?preset=dutch-small&debug&autoplay=0`);
    await page.waitForFunction(() => window.fcResult?.status === 'finished', null, { timeout });
    await page.fill('input[aria-label="Gold"]', '5000');
    await page.click('button[data-debug="gold"]');
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window.__hold = 'europe'));
    await page.click('button[data-command=showEurope]');
    const panel = page.locator('[role=dialog][data-kind=europe]');
    await panel.waitFor({ timeout: 10_000 });
    await panel.locator('button[data-europe=purchase]').click();
    const offers = panel.locator('[data-shop=purchase] [data-offer]');
    const ships = ['model.unit.caravel', 'model.unit.galleon', 'model.unit.merchantman', 'model.unit.frigate'];
    for (let i = 0; i < (await offers.count()); i++) {
      if (ships.includes((await offers.nth(i).getAttribute('data-offer'))!)) {
        await offers.nth(i).click();
        break;
      }
    }
    await panel.locator('[data-list=inPort] [data-unit]').first().waitFor({ timeout: 60_000 });
    const shop = panel.locator('[data-shop]');
    if ((await shop.count()) > 0) await shop.locator('button.close').click();
    // Let the effects be decoded, as a player takes a moment to look at the market.
    await page.waitForTimeout(3000);
    // A browser with no audio device (the Docker Firefox) never runs a context: nothing can start there.
    await page.mouse.click(5, 5);
    const runs = await page.evaluate(async () => {
      const probe = new AudioContext();
      await Promise.race([probe.resume(), new Promise((ok) => setTimeout(ok, 3000))]);
      return probe.state === 'running';
    });
    if (!runs) {
      console.log(`${name}: no audio device, so no Web Audio context runs; the first sound is not checked`);
      return lines;
    }
    const started = () => lines.filter((l) => /source start ctx=running/.test(l)).length;
    const before = started();
    await panel.locator('[data-list=market] [data-goods]').first().click();
    await panel.locator('[data-list=cargo] [data-cargo=goods]').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (started() <= before) throw new Error('the first load of cargo started no sound');
    return lines;
  } finally {
    await browser.close();
  }
}

let failed = false;
for (const name of browserNames()) {
  try {
    await firstLoadSound(name);
    console.log(`${name} first load of cargo: a sound started: ok`);
  } catch (ex) {
    failed = true;
    console.log(`${name} first load of cargo: FAILED ${await diagnose(ex)}`);
  }
  for (const music of [false, true]) {
    const label = `${name} music ${music ? 'on' : 'off'}`;
    try {
      const l = await load(name, music);
      // Sound effects are fetched once the game starts (#391); music is not, unless it is on.
      const notEffect = l.audio.filter((f) => !EFFECT.test(`/audio/${f}`));
      const unwanted = music ? notEffect.filter((f) => !INTRO.test(`/audio/${f}`)) : notEffect;
      const problems = [
        ...unwanted.map((f) => `fetched ${f}`),
        ...(l.workers ? [`${l.workers} service worker registrations or caches`] : []),
        ...l.errors,
      ];
      failed ||= problems.length > 0;
      console.log(
        `${label}: start screen ${MB(l.startScreen)} MB, first turn ${MB(l.firstTurn)} MB ` +
          `(audio ${l.audio.length} files, ${MB(l.audioBytes)} MB: ${l.audio.join(' ') || '-'}); ` +
          (problems.length ? `FAILED ${problems.join('; ')}` : 'ok'),
      );
    } catch (ex) {
      failed = true;
      console.log(`${label}: FAILED ${await diagnose(ex)}`);
    }
  }
}
server.close();
process.exit(failed ? 1 : 0);
