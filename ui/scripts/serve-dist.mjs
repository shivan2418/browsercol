// Serves dist/ statically under a sub-path, as GitHub Pages does, for the
// browser scripts. Counts fetches of the data bundle.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const dist = path.resolve(import.meta.dirname, '../../dist');
const base = '/freecol-online/';

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

/**
 * A site already deployed (--url https://host/path/), tested as is: nothing is served, and the
 * data bundle fetches are counted from the page's own requests, so call watch(page) on each page.
 */
function remoteSite(raw) {
  let dataFetches = 0;
  return {
    url: raw.endsWith('/') ? raw : raw + '/',
    watch: (page) =>
      page.on('request', (r) => {
        if (/\/assets\/data-[^/]*\.json$/.test(new URL(r.url()).pathname)) dataFetches++;
      }),
    dataFetches: () => dataFetches,
    resetDataFetches: () => (dataFetches = 0),
    close: () => {},
  };
}

/** Start serving; resolves to { url, dataFetches(), close() }. With --url, the deployed site instead. */
export async function serveDist() {
  const i = process.argv.indexOf('--url');
  if (i >= 0) return remoteSite(process.argv[i + 1]);
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
