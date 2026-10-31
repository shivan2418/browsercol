// Times AI rounds as a game grows, in each browser, and samples the browser's
// memory. Serves dist/ as smoke.mjs does, loads it with ?autoplay=N (the
// human auto-ends N turns, so the AI plays N rounds) and polls window.fcRounds.
// Prints one line per sample: the round, the AI's time for that round as the
// Engine measured it ("round" event), the mean of the rounds since the last
// sample, wall seconds since load, and the resident memory (RSS, MB) of the
// browser's process tree, workers included.
// Run in the web image:
//   DEV_VARIANT=web ./dev.sh node ui/scripts/rounds.mjs [--rounds 300] [--browsers chromium,firefox] [--every 25] [--timeout 7200]
// A run that stalls or hits --timeout reports as far as it got. Numbers
// depend on the machine's load, so the script prints the load and CPU.
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { answerDialogs } from './dialogs.mjs';
import { serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright');
const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? dflt : process.argv[i + 1];
};
const rounds = Number(opt('rounds', '300'));
const every = Number(opt('every', '25'));
const timeout = Number(opt('timeout', '7200')) * 1000;
const browsers = opt('browsers', 'chromium,firefox').split(',');

/** Resident memory in MB of this process's descendants (the browser). */
function treeRssMb() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid, rss] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), [pid, rss]]);
  let kb = 0;
  const walk = (pid) => {
    for (const [c, rss] of kids.get(pid) ?? []) {
      kb += rss;
      walk(c);
    }
  };
  walk(process.pid);
  return Math.round(kb / 1024);
}

const cpu = fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/)?.[1];
console.log(
  `machine: ${cpu}, ${os.cpus().length} threads, load ${os
    .loadavg()
    .map((x) => x.toFixed(1))
    .join(' ')}`,
);

const server = await serveDist();
for (const name of browsers) {
  const browser = await playwright[name].launch();
  console.log(`\n${name} ${browser.version()}, load at start ${os.loadavg()[0].toFixed(1)}`);
  console.log('round  ai_ms  mean_ms_since_last  wall_s  rss_mb  load1');
  const page = await browser.newPage();
  await answerDialogs(page);
  page.on('pageerror', (e) => console.log(`page error: ${e}`));
  const t0 = Date.now();
  await page.goto(`${server.url}?autoplay=${rounds}`);
  let next = 1;
  let last = 0;
  let stall = Date.now();
  let seen = 0;
  let all = [];
  while (Date.now() - t0 < timeout) {
    let state;
    try {
      state = await page.evaluate(() => ({ r: window.fcRounds ?? [], res: window.fcResult?.status }));
    } catch (ex) {
      console.log(
        `page gone after ${seen} rounds, ${((Date.now() - t0) / 1000).toFixed(0)} s: ${String(ex).split('\n')[0]}`,
      );
      break;
    }
    all = state.r;
    if (state.r.length !== seen) {
      seen = state.r.length;
      stall = Date.now();
    }
    while (state.r.length >= next) {
      const ms = state.r.slice(last, next).map((x) => Number(x.split(',')[1]));
      const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
      console.log(
        `${String(next).padStart(5)} ${String(ms.at(-1)).padStart(6)} ${mean.toFixed(0).padStart(10)} ` +
          `${((Date.now() - t0) / 1000).toFixed(0).padStart(11)} ${String(treeRssMb()).padStart(7)} ${os.loadavg()[0].toFixed(1).padStart(6)}`,
      );
      last = next;
      next = next === 1 ? every : next + every;
    }
    if (state.res === 'finished' || state.res === 'failed') {
      console.log(`status ${state.res}, ${state.r.length} rounds`);
      break;
    }
    if (Date.now() - stall > 600000) {
      console.log(`stalled at round ${state.r.length} for 10 minutes`);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`rounds done: ${all.length}; all ai_ms: ${all.map((x) => x.split(',')[1]).join(' ')}`);
  await browser.close().catch(() => {});
}
server.close();
