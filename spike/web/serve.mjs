// Static file server for dist/ with selectable content-encoding.
// As a module: serve(dir, encoding) -> {url, close}; encoding is 'identity', 'gzip' or 'br'.
// As a script: node serve.mjs [dir] [encoding] [port] [mbps]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.txt': 'text/plain' };
const q = zlib.constants.BROTLI_PARAM_QUALITY;
const packers = {
  gzip: b => zlib.gzipSync(b, { level: 9 }),
  br: b => zlib.brotliCompressSync(b, { params: { [q]: 11 } }),
};

// onResult, if given, receives the JSON the page POSTs to /result, so a
// browser launched without Playwright can report back.
// mbps, if given, paces every response to that many megabits per second,
// shared by all responses in flight, as one network link would be.
export function serve(dir, encoding = 'identity', port = 0, onResult = null, mbps = 0) {
  const link = { free: 0 };   // time (ms) the simulated link is next idle
  // Compress everything up front, so brotli -11's cost stays out of the timings.
  const cache = new Map();
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, f);
    if (!fs.statSync(file).isFile()) continue;
    const body = fs.readFileSync(file);
    cache.set(file, encoding === 'identity' ? body : packers[encoding](body));
  }
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = '';
      req.on('data', c => body += c).on('end', () => {
        res.writeHead(204).end();
        if (onResult) onResult(JSON.parse(body));
      });
      return;
    }
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html');
    const file = path.join(dir, path.normalize(name));
    if (!file.startsWith(dir) || !cache.has(file)) {
      res.writeHead(404).end(); return;
    }
    const body = cache.get(file);
    const headers = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': 'no-store' };
    if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
    res.writeHead(200, headers);
    if (!mbps) { res.end(body); return; }
    // Queue the body on the shared link in 64 KiB slices.
    const bytesPerMs = mbps * 1e6 / 8 / 1000, slice = 65536;
    for (let at = 0; at < body.length; at += slice) {
      const chunk = body.subarray(at, at + slice), last = at + slice >= body.length;
      link.free = Math.max(link.free, Date.now()) + chunk.length / bytesPerMs;
      setTimeout(() => last ? res.end(chunk) : res.write(chunk), link.free - Date.now());
    }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () =>
    ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = 'dist', enc = 'identity', port = '8080', mbps = '0'] = process.argv.slice(2);
  const s = await serve(path.resolve(dir), enc, Number(port), null, Number(mbps));
  console.log(`serving ${dir} (${enc}) at ${s.url}`);
}
