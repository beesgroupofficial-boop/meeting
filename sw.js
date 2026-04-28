const CACHE = "sales-v1";
const ASSETS = ["/", "/index.html", "/css/style.css", "/js/app.js", "/js/firebase-config.js", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.url.includes("firebase") || e.request.url.includes("googleapis")) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
