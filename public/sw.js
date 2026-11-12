// Service worker: lets the game open and run solo races without internet.
//
// - /assets/* files have a hash in their name and never change -> cache first.
// - Pages (index.html, check.html) -> network first, so a new deploy is picked
//   up as soon as you are online; the cached copy is only used offline.
// - Everything else from this site (icons, manifest) -> cached copy first, then
//   refreshed in the background.
// Online races need the connection to the room server, they are not cached.

const SHELL = "kart-shell-v1";
const ASSETS = "kart-assets-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["./", "manifest.webmanifest", "icons/icon-192.png"]))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![SHELL, ASSETS].includes(key) && key.startsWith("kart-"))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the room server, etc.

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(request);
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
