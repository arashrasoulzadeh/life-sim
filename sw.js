// SimYou PWA service worker. The network is always the source of truth; the
// cache is purely an offline fallback. Live data (/stream, /api, /games) is
// never touched.

const CACHE = "simyou-v4";
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

// let the page tell a freshly-installed worker to take over now
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/stream") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/games/")) return;

  // Network-first, and cache-bust the request so no HTTP-cache layer (browser,
  // nginx, CDN) can hand back a stale file. The cached copy is only ever used
  // when the network genuinely fails.
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html"))),
  );
});
