/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// Precache the manifest injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST || []);

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
  if (!event.data) return;

  // A malformed payload must still show *something* — a silent push burns
  // the browser's goodwill (Chrome may show a generic "site updated", and
  // repeated silent pushes can get the subscription throttled/revoked), so
  // fall back to a generic notification rather than parsing-and-bailing.
  let data: PushPayload = {};
  try {
    data = event.data.json();
  } catch (err) {
    console.error('push: failed to parse json', err);
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
  const targetUrl: string = (event.notification.data && event.notification.data.url) || '/';

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
