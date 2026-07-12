const CACHE = "lan-file-share-pwa-v2";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/config.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (new URL(event.request.url).origin === location.origin) event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
