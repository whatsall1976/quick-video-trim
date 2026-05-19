/* Minimal SW: clears any old caches, avoids dev caching issues. */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', () => {
  // Network only.
})
