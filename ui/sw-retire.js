// The service worker's retirement. Builds 18 and 19 installed a worker that kept the game for offline play and
// answered every request from its cache first, so a player who had one would stay on that build. Offline play is
// off for now; the browser fetches sw.js afresh to look for an update, finds this, and this worker deletes the
// saved copy, unregisters itself and reloads the open pages, which then load the current build from the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith('browsercol-')) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
