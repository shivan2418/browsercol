// Playwright harness: loads the served page in Chromium and Firefox, with
// the server sending identity, gzip and brotli, waits for window.spikeResult
// and prints one JSON document plus a short Markdown table per browser.
// Usage: node harness.mjs [--rounds N] [--browsers chromium,firefox] [--encodings identity,gzip,br]
//        [--timeout seconds] [dist dir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright');   // global install, found via NODE_PATH
const opt = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i < 0 ? dflt : process.argv[i + 1]; };
const rounds = opt('rounds', '10');
const browsers = opt('browsers', 'chromium,firefox').split(',');
const encodings = opt('encodings', 'identity,gzip,br').split(',');
const draws = opt('draw', '1').split(',');   // 1: draw the map, 0: skip drawing
const timeout = Number(opt('timeout', '900')) * 1000;
const dist = path.resolve(process.argv.filter((a, i, v) => !a.startsWith('--') && !(v[i - 1] ?? '').startsWith('--')).slice(2)[0] ?? 'dist');

// Raw, gzip -9 and brotli -11 sizes of every served file (as in spike/engine/sizes.mjs).
const q = zlib.constants.BROTLI_PARAM_QUALITY;
const sizes = {};
for (const f of fs.readdirSync(dist, { recursive: true })) {
  const p = path.join(dist, f);
  if (!fs.statSync(p).isFile()) continue;
  const b = fs.readFileSync(p);
  sizes[f] = { raw: b.length, gzip: zlib.gzipSync(b, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(b, { params: { [q]: 11 } }).length };
}

const log = (...a) => console.error('[harness]', ...a);
const results = [];
for (const name of browsers) {
  for (const encoding of encodings) for (const draw of draws) {
    const server = await serve(dist, encoding);
    const browser = await playwright[name].launch({ headless: true });
    const page = await (await browser.newContext()).newPage();   // fresh context: cold cache
    const requests = {};   // url path -> transfer info; also sees the Worker's fetches
    page.on('response', r => {
      const h = r.headers(), u = new URL(r.url()).pathname;
      requests[u] = { status: r.status(), encoding: h['content-encoding'] ?? 'identity', transferred: Number(h['content-length'] ?? 0) };
    });
    page.on('pageerror', e => log(name, 'pageerror', e.message));
    page.on('console', m => m.type() === 'error' && log(name, 'console.error', m.text()));
    log(name, encoding, 'draw', draw, 'loading');
    const t0 = Date.now();
    let result, error;
    try {
      await page.goto(`${server.url}?rounds=${rounds}&draw=${draw}`);
      await page.waitForFunction(() => window.spikeResult, null, { timeout });
      result = await page.evaluate(() => window.spikeResult);
    } catch (ex) { error = String(ex); }
    const resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .map(e => ({ name: new URL(e.name).pathname, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize }))).catch(() => []);
    results.push({ browser: name, version: browser.version(), encoding, draw, wallMs: Date.now() - t0, error, result, requests, resources });
    await browser.close(); await server.close();
  }
}

console.log(JSON.stringify({ rounds: Number(rounds), sizes, results }, null, 1));

// ---- Markdown summary ----
const kib = n => (n / 1024).toFixed(0);
const ms = n => n == null ? '-' : Math.round(n);
const md = [];
md.push('## Download size per file (KiB)', '', '| file | raw | gzip -9 | brotli -11 |', '|---|---:|---:|---:|');
for (const [f, s] of Object.entries(sizes)) md.push(`| ${f} | ${kib(s.raw)} | ${kib(s.gzip)} | ${kib(s.brotli)} |`);
md.push('', '## Runs', '',
  '| browser | encoding | draw | status | transferred KiB | data fetch | client wasm | worker wasm | client ready | server started | game started | avg round | total | msgs to srv / to cli | KiB to srv / to cli | renderer |',
  '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|');
for (const r of results) {
  const x = r.result;
  if (!x) { md.push(`| ${r.browser} ${r.version} | ${r.encoding} | ${r.draw} | ERROR ${r.error} |`); continue; }
  const t = x.timings, rs = x.roundStats.filter(s => s.round > 0);
  const avg = rs.length ? rs.reduce((a, s) => a + s.ms, 0) / rs.length : null;
  const xfer = Object.values(r.requests).reduce((a, q) => a + q.transferred, 0);
  md.push(`| ${r.browser} ${r.version} | ${r.encoding} | ${r.draw} | ${x.status}${x.error ? ': ' + x.error.slice(0, 60) : ''} | ${kib(xfer)} | ${ms(t.dataFetchMs)} | ${ms(t.clientWasmMs)} | ${ms(t.worker?.wasmMs)} | ${ms(t.clientReady)} | ${ms(t.serverStarted)} (srv ${ms(t.serverReportedMs)}) | ${ms(t.gameStarted)} | ${ms(avg)} | ${ms(t.total)} | ${x.total.toServerMsgs} / ${x.total.toClientMsgs} | ${kib(x.total.toServerBytes)} / ${kib(x.total.toClientBytes)} | ${x.renderer} |`);
}
for (const r of results.filter(r => r.result && r.encoding === encodings[0])) {
  md.push('', `### Per round, ${r.browser} (${r.encoding}, draw ${r.draw})`, '', '| round | ms | draw ms | msgs to srv | KiB to srv | msgs to cli | KiB to cli |', '|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of r.result.roundStats) md.push(`| ${s.label ?? s.round} | ${ms(s.ms)} | ${ms(s.drawMs)} | ${s.toServerMsgs} | ${(s.toServerBytes / 1024).toFixed(1)} | ${s.toClientMsgs} | ${(s.toClientBytes / 1024).toFixed(1)} |`);
}
console.error('\n' + md.join('\n'));
fs.writeFileSync(path.join(dist, '..', 'results.md'), md.join('\n') + '\n');
