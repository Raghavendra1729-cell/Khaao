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
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
);

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Notification', {
        body: data.body || '',
        icon: '/icon-192.png',
      })
    );
  } catch (err) {
    console.error('push: failed to parse json', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if any
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
