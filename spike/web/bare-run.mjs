// Runs the page in a browser launched directly, with no DevTools protocol
// attached, to check whether Playwright's instrumentation changes the
// timings. The page POSTs its result to the server.
// Usage: node bare-run.mjs chromium|firefox [rounds] [extra query, e.g. draw=0]
//   env ENCODING=identity|gzip|br (default br), MBPS=<link speed> (default unthrottled)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serve } from './serve.mjs';

const [name = 'chromium', rounds = '10', query = ''] = process.argv.slice(2);
const dir = 'dist';
const find = (prefix, rel) => {
  const root = '/ms-playwright';
  const d = fs.readdirSync(root).find(f => f.startsWith(prefix + '-'));
  return path.join(root, d, rel);
};
let done;
const result = new Promise(r => done = r);
const encoding = process.env.ENCODING ?? 'br', mbps = Number(process.env.MBPS ?? 0);
const server = await serve(path.resolve(dir), encoding, 0, done, mbps);
const url = `${server.url}?rounds=${rounds}&${query}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
const proc = name === 'firefox'
  ? spawn(find('firefox', 'firefox/firefox'), ['--headless', '--no-remote', '--profile', profile, url])
  : spawn(find('chromium', 'chrome-linux/chrome'), ['--headless=new', '--no-sandbox', '--no-first-run',
      `--user-data-dir=${profile}`, url]);
proc.stderr.on('data', () => {});
const r = await Promise.race([result, new Promise(r => setTimeout(() => r(null), 600000))]);
proc.kill();
await server.close();
if (!r) { console.error('no result'); process.exit(1); }
const rs = r.roundStats.filter(s => s.round > 0);
console.log(JSON.stringify({ browser: name, encoding, mbps, status: r.status, error: r.error, userAgent: r.userAgent,
  dataFetchMs: Math.round(r.timings.dataFetchMs), clientReady: Math.round(r.timings.clientReady),
  serverStarted: Math.round(r.timings.serverStarted), gameStarted: Math.round(r.timings.gameStarted), clientWasmMs: Math.round(r.timings.clientWasmMs),
  workerWasmMs: Math.round(r.timings.worker?.wasmMs), avgRound: Math.round(rs.reduce((a, s) => a + s.ms, 0) / rs.length),
  rounds: rs.map(s => s.ms), total: Math.round(r.timings.total) }));
process.exit(0);
