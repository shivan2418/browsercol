// The service worker (#296): BrowserCol plays offline once it has been opened. ui/scripts/pwa.ts fills in the
// build's name and the shell's file list, and vite.config.ts writes the result beside the site as sw.js.
//
// The shell (the page, the Engines, the data, the scripts, styles and fonts, the maps, the art, the presets, the
// icons and the sound effects) is cached whole at install. The music (93 MB) comes after: the page asks for all of it
// as soon as this worker has it, since offline a track not in the cache fails to load. It is not part of the install,
// which the browser stops after a few minutes: on a slow line that would leave no worker at all. The translations
// are cached as the game loads them. The cache is named for the build, so a new build's worker fills a new one and
// the old one goes when the player restarts into it. The page shows "A new version is ready" while the new worker
// waits, and sends it 'skip-waiting' when the player presses Restart; it does not take over a running game.
// Once active it claims the open page, so the art a first visit loads after the shell is in is kept too. A worker
// activates on a first visit, through Restart, or once no page of the old build is open, so a page it claims runs
// its own build.

const BUILD = __BUILD__;
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
      const older = (await caches.keys()).filter((name) => name.startsWith('browsercol-') && name !== CACHE);
      await carryAudio(older);
      for (const name of older) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'skip-waiting') self.skipWaiting();
  // The music, cached whole as soon as the page has a worker (#505): the page asks, and the worker reports.
  else if (type === 'cache-audio') event.waitUntil(cacheAudio());
  else if (type === 'drop-audio') event.waitUntil(dropAudio());
  else if (type === 'audio-status') event.waitUntil(report(false));
});

/** Every audio file as [URL, bytes]: the build's list, put in by ui/scripts/pwa.ts. */
const AUDIO = __AUDIO__.map(([file, bytes]) => [new URL(file, scope).href, bytes]);
const AUDIO_TOTAL = AUDIO.reduce((sum, [, bytes]) => sum + bytes, 0);
/** How many files are fetched at once. */
const AUDIO_PARALLEL = 3;
/** The fill that is running, and whether it was told to stop. */
let filling = null;
let stop = false;
/** Files the running fill could not fetch. */
let failed = 0;

/** Tell every open page how far the audio is: 'working' while a fill runs, else 'done' once every file is in. */
async function report(working) {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const got = AUDIO.filter(([url]) => have.has(url));
  const bytes = got.reduce((sum, [, size]) => sum + size, 0);
  const state = working ? 'working' : got.length === AUDIO.length && AUDIO.length > 0 ? 'done' : 'idle';
  const message = {
    type: 'audio-progress',
    state,
    done: got.length,
    total: AUDIO.length,
    bytes,
    totalBytes: AUDIO_TOTAL,
    failed,
  };
  for (const client of await self.clients.matchAll()) client.postMessage(message);
}

/** Fetch the audio files the cache lacks, a few at a time. One failing file is counted, not the end of the rest. */
function cacheAudio() {
  if (!filling) {
    stop = false;
    failed = 0;
    filling = fill().finally(() => {
      filling = null;
    });
  }
  return filling;
}

async function fill() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const queue = AUDIO.filter(([url]) => !have.has(url));
  await report(true);
  const worker = async () => {
    for (let next = queue.shift(); next && !stop; next = queue.shift()) {
      try {
        const response = await fetch(new Request(next[0], { headers: { 'X-Precache': '1' }, cache: 'reload' }));
        if (response.status !== 200) throw new Error(String(response.status));
        if (!stop) await cache.put(next[0], response);
      } catch {
        failed++;
      }
      await report(true);
    }
  };
  await Promise.all(Array.from({ length: AUDIO_PARALLEL }, worker));
  await report(false);
}

/**
 * Put the music the last build's cache has into this one's before it goes, rather than download 93 MB again: a file
 * of the same name and size is the same file. A copy within the browser, quick next to the network.
 */
async function carryAudio(older) {
  const cache = await caches.open(CACHE);
  for (const [url, bytes] of AUDIO) {
    if (await cache.match(url)) continue;
    for (const name of older) {
      const hit = await (await caches.open(name)).match(url);
      if (hit && (await hit.clone().blob()).size === bytes) {
        await cache.put(url, hit);
        break;
      }
    }
  }
}

/** Drop every audio file from the cache; the ones that play again are cached as they play. */
async function dropAudio() {
  stop = true;
  await filling;
  const cache = await caches.open(CACHE);
  for (const [url] of AUDIO) await cache.delete(url);
  failed = 0;
  await report(false);
}

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
