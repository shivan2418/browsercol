// BrowserCol as an installed app (#267): the theme colour the window's title bar takes from the menu bar, and the
// removal of the service worker builds 18 and 19 installed for offline play, which is off for now.

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

/**
 * Remove a service worker left by builds 18 and 19, and the copy of the game it saved. Offline play is off for now;
 * sw.js is a worker that does the same (sw-retire.js), for a page the old worker still serves from its cache.
 */
export async function removeServiceWorker(
  container: Pick<ServiceWorkerContainer, 'getRegistrations'> | undefined = 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined,
) {
  if (!container) return;
  for (const reg of await container.getRegistrations()) await reg.unregister();
  for (const name of typeof caches === 'undefined' ? [] : await caches.keys())
    if (name.startsWith('browsercol-')) await caches.delete(name);
}
