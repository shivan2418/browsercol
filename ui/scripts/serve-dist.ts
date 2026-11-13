// Serves dist/ (the landing page, with the game under play/) statically under a sub-path, as GitHub Pages does, for the
// browser scripts. Counts fetches of the data bundle.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Page, Request } from 'playwright-core';

export const dist = path.resolve(import.meta.dirname, '../../dist');
const base = '/browsercol/';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
};

/** The site under test: the game's URL (the site's play/ page), the site's root, and the data bundle fetches so far. */
export interface Site {
  /** The game, at <root>play/ (the site's root is the landing page, #374). */
  url: string;
  root: string;
  /** Counts a deployed site's data bundle fetches from the page's own requests; absent when the site is served here. */
  watch?: (page: Page) => unknown;
  dataFetches: () => number;
  resetDataFetches: () => number;
  close: () => void;
}

/**
 * A site already deployed (--url https://host/path/), tested as is: nothing is served, and the
 * data bundle fetches are counted from the page's own requests, so call watch(page) on each page.
 */
function remoteSite(raw: string): Site {
  let dataFetches = 0;
  const root = raw.endsWith('/') ? raw : raw + '/';
  return {
    url: root + 'play/',
    root,
    watch: (page: Page) =>
      page.on('request', (r: Request) => {
        if (/\/assets\/data-[^/]*\.json$/.test(new URL(r.url()).pathname)) dataFetches++;
      }),
    dataFetches: () => dataFetches,
    resetDataFetches: () => (dataFetches = 0),
    close: () => {},
  };
}

/** Start serving; resolves to { url, dataFetches(), close() }. With --url, the deployed site instead. */
export async function serveDist(): Promise<Site> {
  const i = process.argv.indexOf('--url');
  if (i >= 0) return remoteSite(process.argv[i + 1]!);
  let dataFetches = 0;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    // The service worker's install fetches the data bundle too (X-Precache); only the page's own fetches count.
    if (/\/assets\/data-[^/]*\.json$/.test(name) && !req.headers['x-precache']) dataFetches++;
    if (!name.startsWith(base)) return res.writeHead(404).end();
    const file = path.join(dist, path.normalize(name.slice(base.length) + (name.endsWith('/') ? 'index.html' : '')));
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
  return {
    url: `${root}play/`,
    root,
    dataFetches: () => dataFetches,
    resetDataFetches: () => (dataFetches = 0),
    close: () => server.close(),
  };
}
