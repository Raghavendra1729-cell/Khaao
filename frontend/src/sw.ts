/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

// `injectManifest` mode (unlike `generateSW`) does NOT inject skipWaiting/
// clientsClaim into this file automatically. Without them, an updated
// worker sits in "waiting" until every tab/window running the old one
// closes — which never happens on a backgrounded phone, so an installed
// PWA is pinned to whatever build it first installed, forever. See
// STATUS.md § 9.8-W1.
self.skipWaiting();
clientsClaim();

// Precache the manifest injected by vite-plugin-pwa, and drop caches left
// over from earlier precache generations (otherwise they accumulate across
// deploys — nothing evicts them on its own in injectManifest mode).
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// Serve index.html for all navigation requests, except those to /api/
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//],
});
registerRoute(navigationRoute);

// API calls should always go to the network (never cache or buffer)
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

interface PushPayload {
  title?: string;
  body?: string;
  /** App-relative path notificationclick should focus/open (backend: services/push.go). */
  url?: string;
}

self.addEventListener('push', (event) => {
  // A push with no data, or one whose payload fails to parse, must still
  // show *something* — a silent push burns the browser's goodwill (Chrome
  // may show a generic "site updated", and repeated silent pushes can get
  // the subscription throttled/revoked), so fall back to a generic
  // notification in both cases rather than bailing out of the handler.
  let data: PushPayload = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      console.error('push: failed to parse json', err);
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Khaao', {
      body: data.body || 'You have a new update.',
      icon: '/icon-192.png',
      // Stacked notifications coalesce into one instead of piling up.
      tag: 'khaao-order',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl: string = (event.notification.data && event.notification.data.url) || '/';
  // Defense in depth: the payload is server-controlled today, but never
  // trust it to stay that way. Only ever navigate within this origin —
  // reject anything that isn't an app-relative path (a protocol-relative
  // "//host" would otherwise leave the origin just like an absolute URL).
  const targetUrl = rawUrl.startsWith('/') && !rawUrl.startsWith('//') ? rawUrl : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus an existing window if any, navigating it to the notification's
      // target first (it may currently be on some other page). matchAll was
      // called with type: 'window', so every result is a WindowClient.
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i] as WindowClient;
        if (client.url.startsWith(self.registration.scope)) {
          return client.navigate(targetUrl).then((navigated) => (navigated ?? client).focus());
        }
      }
      // Otherwise open a new window at the target.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
