/* TrueTest Donor Portal — minimal service worker.
 *
 * Goals:
 *   1. Make the portal installable (SW presence + fetch handler is required).
 *   2. Show an offline fallback for /portal navigation when the network is
 *      down, so donors who opened the app offline see an explanation rather
 *      than a blank browser error.
 *
 * Non-goals (deliberately): caching the order PDF, caching signed URLs, or
 * any stale-while-revalidate for API calls. Those are dynamic and privacy-
 * sensitive and should always hit the network.
 */

const CACHE = "ttl-portal-v1";
const SHELL = ["/portal", "/icon-192.png", "/icon-512.png", "/logo.png", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {
      // If one of the shell assets 404s, don't abort install — the SW
      // can still run and serve fresh network responses for everything else.
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only intercept GET navigations within our scope.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses — authentication state & signed URLs must be fresh.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/portal").then((hit) =>
          hit ||
          new Response(
            "<h1>Offline</h1><p>Connect to the internet and reopen the portal.</p>",
            { status: 200, headers: { "Content-Type": "text/html" } }
          )
        )
      )
    );
    return;
  }

  // Static assets: cache-first, fall back to network.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req))
  );
});

// ── Web Push ──────────────────────────────────────────────────────────────
// Server sends JSON { title, body, url } via web-push; we show it as a
// system notification and, on click, open (or focus) the portal.

self.addEventListener("push", (event) => {
  let payload = { title: "TrueTest Labs", body: "You have an update.", url: "/portal" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // If the server sent a plain string, use it as the body.
    try { payload.body = event.data.text(); } catch {}
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "ttl-selection",
      renotify: true,
      data: { url: payload.url || "/portal" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes("/portal") && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
