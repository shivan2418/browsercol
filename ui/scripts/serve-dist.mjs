// Serves dist/ statically under a sub-path, as GitHub Pages does, for the
// browser scripts. Counts fetches of the data bundle.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const dist = path.resolve(import.meta.dirname, '../../dist');
const base = '/freecol-online/';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

/** Start serving; resolves to { url, dataFetches(), close() }. */
export async function serveDist() {
  let dataFetches = 0;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (/\/assets\/data-[^/]*\.json$/.test(name)) dataFetches++;
    if (!name.startsWith(base)) return res.writeHead(404).end();
    const file = path.join(dist, path.normalize(name.slice(base.length) || 'index.html'));
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}${base}`,
    dataFetches: () => dataFetches,
    resetDataFetches: () => (dataFetches = 0),
    close: () => server.close(),
  };
}
