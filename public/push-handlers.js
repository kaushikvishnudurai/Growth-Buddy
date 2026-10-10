/* Web Push handlers, imported into the generated service worker (see
   vite.config.js workbox.importScripts). Shows the pushed notification and
   focuses/opens the app when it's tapped. A reminder's push also carries a
   Snooze button: the worker has no session (the token lives in the page), so
   the push brings a signed ticket good for snoozing that one reminder, and
   the tap sends it to /api/reminders/snooze-link without opening the app. */
/* global self, clients, fetch */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Growth Buddy', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Growth Buddy';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/', snooze: data.snooze || null },
  };
  // One card per reminder: its snooze replaces it rather than stacking a second.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  if (data.snooze) {
    options.actions = [{ action: 'snooze', title: data.snoozeLabel || 'Snooze' }];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === 'snooze' && data.snooze) {
    // A failed snooze used to vanish: the card closed, nothing rang again, and
    // the user believed it was handled. Say so, on a card that opens the app.
    const failed = () =>
      self.registration.showNotification('Couldn’t snooze — tap to open', {
        body: event.notification.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: event.notification.tag || undefined,
        data: { url: data.url || '/' },
      });
    event.waitUntil(
      fetch('/api/reminders/snooze-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.snooze }),
      })
        .then((res) => (res.ok ? null : failed()))
        .catch(failed)
    );
    return;
  }
  event.waitUntil(openApp(data.url || '/'));
});

function openApp(url) {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ('focus' in w) {
        w.navigate(url);
        return w.focus();
      }
    }
    return clients.openWindow(url);
  });
}
