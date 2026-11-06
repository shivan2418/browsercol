// The service worker (#267): BrowserCol plays offline once it has been opened. ui/scripts/pwa.ts fills in the
// build's name and the shell's file list, and vite.config.ts writes the result beside the site as sw.js.
//
// The shell (the page, the Engines, the data, the scripts, styles and fonts, the icons) is cached whole at install.
// The art, the audio, the translations and the presets are large and only some of them are ever used, so they are
// cached as the game loads them. The cache is named for the build, so a new build's worker fills a new one and
// the old one goes when the player restarts into it. The page shows "A new version is ready" while the new worker
// waits, and sends it 'skip-waiting' when the player presses Restart; it does not take over a running game.
// It does not claim the page that registered it either, so that page's own loads are never answered from a cache.

const BUILD = '__BUILD__';
const CACHE = `browsercol-${BUILD}`;
const SHELL = __SHELL__;

const scope = self.registration.scope;
/** The page: any navigation within the scope, whatever its query. */
const PAGE = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const file of SHELL) {
        const url = new URL(file, scope).href;
        // The header lets the browser scripts' server tell this fetch from the page's own.
        const response = await fetch(new Request(url, { headers: { 'X-Precache': '1' }, cache: 'reload' }));
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        await cache.put(url, response);
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('browsercol-') && name !== CACHE) await caches.delete(name);
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(scope)) return;
  event.respondWith(answer(event, request, url));
});

/** The cached file, or the network's (cached as it loads); a Range request is answered from a whole cached file. */
async function answer(event, request, url) {
  const cache = await caches.open(CACHE);
  const key = request.mode === 'navigate' ? PAGE : url.origin + url.pathname;
  const hit = await cache.match(key);
  if (hit) return slice(request, hit);
  const response = await fetch(request);
  if (response.status === 200) {
    event.waitUntil(cache.put(key, response.clone()));
  } else if (response.status === 206) {
    // The audio element asks for a range; keep the whole file for next time.
    event.waitUntil(cache.add(key).catch(() => {}));
  }
  return response;
}

/** A cached whole file as the range the request asked for, as the network would have answered. */
async function slice(request, response) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!range || (range[1] === '' && range[2] === '')) return response;
  const blob = await response.blob();
  const size = blob.size;
  const start = range[1] === '' ? Math.max(size - Number(range[2]), 0) : Number(range[1]);
  const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? blob.type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  });
}
