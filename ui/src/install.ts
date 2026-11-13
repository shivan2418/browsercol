// BrowserCol as an installed app (#267, #296): the service worker's registration, the "new version" offer, and the
// theme colour the window's title bar takes from the menu bar.

/** What registering needs of the browser, so a test can stand in for it. */
export interface Registrar {
  /** True in a built site, where there is a worker to register. */
  production: boolean;
  container:
    | Pick<ServiceWorkerContainer, 'register' | 'getRegistrations' | 'controller' | 'addEventListener'>
    | undefined;
  /** The files under the page's folder that the page has loaded so far (its translation, a sound it played). */
  loaded: () => string[];
}

/**
 * Register the service worker (a built site only) and call `offer(restart)` when a new build is waiting while an
 * older one runs the page; `restart` swaps the worker and reloads the page. In a dev server there is no worker:
 * one left by a built site at the same address is removed, so the dev server's files are never stale.
 *
 * On a first visit the worker takes the page over once the shell is cached; the page then loads again what it
 * loaded before that (its translation, a sound it played), so the worker keeps those too.
 */
export async function registerServiceWorker(offer: (restart: () => void) => void, r: Registrar = site()) {
  const { container } = r;
  // Not in a secure context (a dev server on a LAN address), where the browser has no workers.
  if (!container) return;
  if (!r.production) {
    for (const reg of await container.getRegistrations()) await reg.unregister();
    for (const name of typeof caches === 'undefined' ? [] : await caches.keys())
      if (name.startsWith('browsercol-')) await caches.delete(name);
    return;
  }
  const firstVisit = !container.controller;
  const reg = await container.register('./sw.js');
  let restarting = false;
  const waiting = (worker: ServiceWorker) => {
    // The first worker has no older one to replace.
    if (!container.controller) return;
    offer(() => {
      restarting = true;
      worker.postMessage({ type: 'skip-waiting' });
    });
  };
  container.addEventListener('controllerchange', () => {
    // The new worker took over: the page it was waiting to replace reloads into the new build.
    if (restarting) location.reload();
    // The first worker took the page over: what the page loaded before goes through it, so it is kept.
    else if (firstVisit) for (const url of r.loaded()) void fetch(url).catch(() => {});
  });
  if (reg.waiting) waiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') waiting(worker);
    });
  });
  // A page left open for days looks for a new build now and then, not only when it is opened.
  setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
}

function site(): Registrar {
  return {
    production: import.meta.env.PROD,
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    loaded: () => {
      const folder = new URL('./', location.href).href;
      return performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((url) => url.startsWith(folder));
    },
  };
}

/** Make the browser's theme colour (the installed window's title bar) the palette's menu bar colour. */
export function syncThemeColor(doc: Document = document) {
  const colour = getComputedStyle(doc.documentElement).getPropertyValue('--menubar').trim();
  if (!colour) return;
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.append(meta);
  }
  meta.content = colour;
}
