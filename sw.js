// SimYou PWA service worker — caches the app shell so it opens instantly and
// survives a flaky connection. Live data (/stream, /api, /games) is never cached.

const CACHE = "simyou-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/src/main.js",
  "/src/render/draw.js",
  "/src/engine/audio.js",
  "/src/engine/rng.js",
  "/src/sim/rooms.js",
  "/src/sim/constants.js",
  "/src/sim/mood.js",
  "/src/sim/weather.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/stream") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/games/")) return;

  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          })
          .catch(() => caches.match("/index.html")),
    ),
  );
});
