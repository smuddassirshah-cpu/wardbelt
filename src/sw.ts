// Decision notes: injectManifest service worker. Workbox precaches the app shell from the
// manifest Vite injects at build; navigation requests fall back to the cached index so an
// offline reload works. Notification clicks focus an open client or open the app scope.
// Update policy per PLAN.md section 8: the page decides when to skip waiting (message
// SKIP_WAITING), never a silent reload.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const indexUrl = new URL('index.html', self.registration.scope).href;
registerRoute(new NavigationRoute(createHandlerBoundToURL(indexUrl)));

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((c) => c.url.startsWith(scope));
      if (open !== undefined) {
        await open.focus();
        return;
      }
      await self.clients.openWindow(scope);
    }),
  );
});
