// Peak memory of the page's process while a game starts and plays (#510), as a stand-in for what an
// iPhone's Safari allows a tab before it reloads it. Samples the proportional set size (PSS) of the
// browser's content processes every 250 ms from /proc: Chromium's renderers, WebKit's web process
// (the same engine as Safari on iOS). The page and its Engine Worker share that process. Prints the
// peak at each phase: the start screen with both Engines loaded, the game started, and after the AI
// has played --autoplay rounds for the player.
// Run in the web image (Linux only, it reads /proc):
//   DEV_VARIANT=web ./dev.sh node ui/scripts/memory.ts [--browsers chromium,webkit] [--autoplay 10] [--wait 20]
import fs from 'node:fs';
import { browserNames, launchBrowser, opt, waitForResult } from './common.ts';
import { answerDialogs } from './dialogs.ts';
import { serveDist } from './serve-dist.ts';

const browsers = browserNames('chromium,webkit');
const autoplay = opt('autoplay', '10');
/** Seconds on the start screen, as a player picking a nation: long enough for both Engines to load. */
const wait = Number(opt('wait', '20')) * 1000;
const server = await serveDist();

/** The content processes of a browser: Chromium's renderers or WebKit's web processes. */
function contentPids(): number[] {
  const pids: number[] = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    try {
      cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (cmd.includes('--type=renderer') || cmd.includes('WebProcess')) pids.push(Number(d));
  }
  return pids;
}

/** PSS in MB of one process, from smaps_rollup; 0 if it is gone. */
function pssMb(pid: number): number {
  try {
    const m = /^Pss:\s+(\d+) kB/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return m ? Number(m[1]) / 1024 : 0;
  } catch {
    return 0;
  }
}

/** The largest content process now (the game's tab; others are spare or service processes). */
const sample = () => Math.max(0, ...contentPids().map(pssMb));

for (const name of browsers) {
  const browser = await launchBrowser(name);
  // An iPhone 14 in landscape, as far as layout goes; memory does not depend on it much.
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 });
  await answerDialogs(page);
  let peak = 0;
  const timer = setInterval(() => (peak = Math.max(peak, sample())), 250);
  const phase = (label: string) => {
    peak = Math.max(peak, sample());
    console.log(`${name}: ${label}: peak ${peak.toFixed(0)} MB, now ${sample().toFixed(0)} MB`);
  };
  await page.goto(`${server.url}?autoplay=${autoplay}`);
  await page.waitForSelector('[data-start]', { timeout: 120000 });
  phase('start screen shown');
  await page.waitForTimeout(wait);
  phase('start screen, both Engines loaded');
  await page.click('[data-start]');
  await page.waitForFunction(() => (window as { fcClientEvent?: unknown }).fcClientEvent !== undefined, null, {
    timeout: 120000,
  });
  await page.waitForTimeout(5000);
  phase('game started');
  const result = await waitForResult(page, 900000);
  phase(`after ${autoplay} rounds (${result.status})`);
  clearInterval(timer);
  await browser.close();
}
server.close();
