/* Heartbeat kill switch. Not active: nothing registers this file.

   To retire a broken service worker, ship a build where this file is served as /sw.js and the page no longer
   calls serviceWorker.register (see "Retiring the service worker" in the README). Browsers check /sw.js for
   changes on their own, install this one at once, and it removes itself and the Heartbeat caches.
   src/app/pwa.test.ts runs this file against fakes. */

// Keeps the old app name on purpose: caches made by earlier builds start with it.
const PREFIX = 'fw-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX)) await caches.delete(key);
      }
      await self.registration.unregister();
      // Reload the open pages so they load straight from the network.
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        try {
          await client.navigate(client.url);
        } catch {
          // A page that can't be navigated keeps working until its next load.
        }
      }
    })(),
  );
});
