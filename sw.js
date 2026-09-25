// ---------------------------------------------------------------------
// UG1 Timetable — service worker
//
// Bump SW_VERSION every time you upload new UI files (index.html, CSS,
// icons, etc.) to InfinityFree. That single-character/number change is
// what makes the browser notice sw.js itself changed, which is what
// kicks off the whole update pipeline below. You don't strictly need
// to touch this for routine timetable/roster CSV edits on GitHub —
// those are re-fetched fresh from GitHub every time anyone opens the
// app while online, version bump or not. Bumping it also resets the
// offline-fallback copy of those CSVs (see DATA_CACHE below), so if
// you ever change the CSV's columns/format alongside a code change,
// bump SW_VERSION at the same time to avoid an offline user getting
// old-format data fed into new-format parsing code.
// ---------------------------------------------------------------------
const SW_VERSION = "5";

const SHELL_CACHE = `ug1-shell-v${SW_VERSION}`;
// Versioned along with the shell on purpose: this holds the
// last-known-good CSV data as an offline fallback. Tying it to
// SW_VERSION means bumping that number both (a) refreshes the app
// shell and (b) throws away any old cached CSV fallback, so a version
// bump is a clean slate for both — the next successful online fetch
// repopulates it under the new version. Data is still always fetched
// from GitHub first whenever you're online; this cache is only ever
// read from when that fetch fails or times out.
const DATA_CACHE = `ug1-data-v${SW_VERSION}`;
// Cross-origin "vendor" assets (Google Fonts, PapaParse from cdnjs).
// Cached best-effort so the UI still looks/works right offline, but
// kept separate so a bad vendor response can never break app updates.
const VENDOR_CACHE = "ug1-vendor";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./favicon-16.png",
  "./favicon-32.png",
  "./favicon-48.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./logo-mark.png"
];

// ---- helpers ----------------------------------------------------------

function isDataRequest(url) {
  return url.hostname.includes("raw.githubusercontent.com") || url.pathname.includes("/data/");
}

function isVendorRequest(url) {
  return (
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com") ||
    url.hostname.includes("cdnjs.cloudflare.com")
  );
}

// Network-first with a hard timeout, falling back to cache. Used for
// timetable/roster CSVs so a slow/broken connection can never hang the
// app — it fails over to the last cached copy quickly instead.
async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

// Stale-while-revalidate: answer instantly from cache — every load,
// online or not, so nothing ever waits on the network — then refresh
// that cache entry in the background from the network for next time.
// ignoreSearch: true is used for the app shell so a shared link with a
// stray "?utm_source=..." (WhatsApp/Instagram sometimes add these)
// still matches the precached page instead of missing and waiting.
function staleWhileRevalidate(request, cacheName, options) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request, options).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      // Prefer whatever's already cached (instant); otherwise wait on
      // the network. Either way the cache gets refreshed above.
      return cached || network;
    })
  );
}

// ---- lifecycle ---------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  // Take over immediately instead of waiting for all tabs to close —
  // paired with the controllerchange reload in index.html, this is what
  // gets users onto the new version without touching their cache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith("ug1-shell-") && k !== SHELL_CACHE) ||
              (k.startsWith("ug1-data-") && k !== DATA_CACHE)
          )
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Timetable/roster CSVs: always prefer the network so schedules never
  // go stale, with a fast timeout + cache fallback for offline/flaky
  // connections. Cached in DATA_CACHE, which survives shell updates.
  if (isDataRequest(url)) {
    event.respondWith(networkFirstWithTimeout(event.request, DATA_CACHE, 6000));
    return;
  }

  // Fonts / PapaParse: cache-first-ish but kept fresh in the background.
  if (isVendorRequest(url)) {
    event.respondWith(staleWhileRevalidate(event.request, VENDOR_CACHE));
    return;
  }

  // Everything else (app shell — HTML/CSS/JS/icons/manifest): serve the
  // cached copy immediately so the app opens instantly, and refresh the
  // cache in the background from the network. Works offline once the
  // shell has been cached once.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE, { ignoreSearch: true }));
    return;
  }

  // Anything unrecognized: just let the browser handle it normally.
});
