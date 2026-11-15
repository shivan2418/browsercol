// The service worker (#296): BrowserCol plays offline once it has been opened. ui/scripts/pwa.ts fills in the
// build's name and the shell's file list, and vite.config.ts writes the result beside the site as sw.js.
//
// The shell (the page, the Engines, the data, the scripts, styles and fonts, the maps, the art, the presets, the
// icons and the sound effects) is cached whole at install. The page and assets/ come as they are; the rest comes in a
// few packs (#519), each the files laid end to end, which the worker splits by the sizes it lists: near a thousand
// files in a few requests. The music and the translations are large and only some of them are ever used, so they are
// cached as the game loads them, or the music all at once on the player's say. The cache is named for the build, so a
// new build's worker fills a new one, copying over the packs the last one has, and
// the old one goes when the player restarts into it. The page shows "A new version is ready" while the new worker
// waits, and sends it 'skip-waiting' when the player presses Restart; it does not take over a running game.
// Once active it claims the open page, so the art a first visit loads after the shell is in is kept too. A worker
// activates on a first visit, through Restart, or once no page of the old build is open, so a page it claims runs
// its own build.

const BUILD = __BUILD__;
const CACHE = `browsercol-${BUILD}`;
/** The shell's files fetched one by one, as [URL relative to the page, bytes]. */
const LOOSE = __LOOSE__;
/** The packs, as [pack URL, its files as [URL, bytes] in the order they are laid in it]. */
const PACKS = __PACKS__;
const SHELL_TOTAL = [...LOOSE, ...PACKS.flatMap(([, files]) => files)].reduce((sum, [, bytes]) => sum + bytes, 0);
/** How many fetches the install runs at once. */
const INSTALL_PARALLEL = 4;

const scope = self.registration.scope;
/** The page: any navigation within the scope, whatever its query. */
const PAGE = new URL('./', scope).href;

self.addEventListener('install', (event) => event.waitUntil(install()));

async function install() {
  const cache = await caches.open(CACHE);
  const older = (await caches.keys()).filter((name) => name.startsWith('browsercol-') && name !== CACHE);
  let bytes = 0;
  let told = -1;
  // A message each percent, not each file or each chunk of a pack.
  const progress = async (more) => {
    bytes += more;
    const percent = Math.floor((100 * bytes) / Math.max(SHELL_TOTAL, 1));
    if (percent !== told) {
      told = percent;
      await tellOffline('saving', bytes);
    }
  };
  await tellOffline('saving', 0);
  const jobs = [
    ...PACKS.map(
      ([pack, files]) =>
        () =>
          savePack(cache, older, pack, files, progress),
    ),
    ...LOOSE.map(([file, size]) => async () => {
      const url = new URL(file, scope).href;
      // The header lets the browser scripts' server tell this fetch from the page's own.
      const response = await fetch(new Request(url, { headers: { 'X-Precache': '1' }, cache: cacheMode(file) }));
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      await cache.put(url, response);
      await progress(size);
    }),
  ];
  // On a failure the queue is emptied, and the page is told once every fetch under way has stopped, so no later
  // 'saving' undoes the 'failed'.
  let failure;
  await Promise.all(
    Array.from({ length: INSTALL_PARALLEL }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        try {
          await job();
        } catch (error) {
          failure ??= error;
          jobs.length = 0;
        }
      }
    }),
  );
  if (failure) {
    await tellOffline('failed', bytes);
    throw failure;
  }
  await tellOffline('saved', bytes);
}

/** The cache entry that says a pack's files are all in: the pack's URL with a query no page asks for. */
const packMark = (pack) => `${new URL(pack, scope).href}?saved`;

/**
 * Put a pack's files in the cache: copied from the last build's cache if it has the same pack (its name is its
 * contents' hash), else downloaded whole and split.
 */
async function savePack(cache, older, pack, files, progress) {
  for (const name of older) {
    const old = await caches.open(name);
    if (!(await old.match(packMark(pack)))) continue;
    const hits = await Promise.all(files.map(([file]) => old.match(new URL(file, scope).href)));
    if (hits.some((hit) => !hit)) continue;
    for (let i = 0; i < files.length; i++) await cache.put(new URL(files[i][0], scope).href, hits[i]);
    await cache.put(packMark(pack), new Response(''));
    await progress(files.reduce((sum, [, size]) => sum + size, 0));
    return;
  }
  const url = new URL(pack, scope).href;
  // Named for its contents, so a copy the browser has is the same.
  const response = await fetch(new Request(url, { headers: { 'X-Precache': '1' }, cache: 'force-cache' }));
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const blob = await readAll(response, progress);
  const total = files.reduce((sum, [, size]) => sum + size, 0);
  if (blob.size !== total) throw new Error(`${url}: ${blob.size} bytes, not ${total}`);
  let at = 0;
  for (const [file, size] of files) {
    const headers = { 'Content-Type': contentType(file), 'Content-Length': String(size) };
    await cache.put(new URL(file, scope).href, new Response(blob.slice(at, at + size), { headers }));
    at += size;
  }
  await cache.put(packMark(pack), new Response(''));
}

/** A response's body as a Blob, telling the progress as it comes, so a slow line shows it moving. */
async function readAll(response, progress) {
  if (!response.body) {
    const blob = await response.blob();
    await progress(blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(next.value);
    await progress(next.value.byteLength);
  }
  return new Blob(chunks);
}

/** A packed file's type, by its name, as the server would have sent it. */
function contentType(file) {
  const ext = /\.(\w+)$/.exec(file)?.[1]?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      json: 'application/json',
      webmanifest: 'application/manifest+json',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      css: 'text/css',
      js: 'text/javascript',
      txt: 'text/plain',
      xml: 'application/xml',
      woff2: 'font/woff2',
    }[ext] ?? 'application/octet-stream'
  );
}

/**
 * How the install fetches a file without downloading again what the page has just loaded: a file whose name has
 * Vite's content hash in it (assets/main-D98mpgMP.js) never changes, so the browser's own cache serves it if it has
 * it; any other file is asked for only if it changed since (a 304, no download, when it did not).
 */
function cacheMode(file) {
  return /^\.\/assets\/.+-[\w-]{8}\.\w+$/.test(file) ? 'force-cache' : 'no-cache';
}

/**
 * Tell every page of the site how far the offline copy is: 'saving' while the install runs, 'saved' once it is in
 * (the worker takes over a first visit's page then), 'failed' if a file could not be had. A first visit's page is
 * not this worker's yet, so uncontrolled pages are told too.
 */
async function tellOffline(state, bytes) {
  const message = { type: 'offline-progress', state, bytes, totalBytes: SHELL_TOTAL };
  for (const client of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) {
    client.postMessage(message);
  }
}

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
  // The music, cached whole on the player's say (#505): the page asks, and the worker reports.
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
        const response = await fetch(new Request(next[0], { cache: 'reload' }));
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
 * Put the music the last build's cache has into this one's before it goes, rather than download it again: a file
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
  let response;
  try {
    response = await fetch(request);
  } catch {
    // Offline and not cached: the page sees a failed load, as without a worker, and the worker logs nothing.
    return Response.error();
  }
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
