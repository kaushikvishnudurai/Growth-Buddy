/* Web Push handlers, imported into the generated service worker (see
   vite.config.js workbox.importScripts). Shows the pushed notification and
   focuses/opens the app when it's tapped. A reminder's push also carries a
   Snooze button: the worker has no session (the token lives in the page), so
   the push brings a signed ticket good for snoozing that one reminder, and
   the tap sends it to /api/reminders/snooze-link without opening the app.
   Done works the same way: a reminder's checks that occurrence off, a plain
   habit's ticks it, each with its own ticket and `doneLink` endpoint. */
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
    data: {
      url: data.url || '/',
      snooze: data.snooze || null,
      done: data.done || null,
      doneLink: data.doneLink || null,
    },
  };
  // One card per reminder: its snooze replaces it rather than stacking a second.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  const actions = [];
  if (data.done && data.doneLink) actions.push({ action: 'done', title: 'Done' });
  if (data.snooze) actions.push({ action: 'snooze', title: data.snoozeLabel || 'Snooze' });
  if (actions.length) options.actions = actions;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // A button the worker can carry out alone: POST its signed ticket.
  const link =
    event.action === 'snooze' && data.snooze
      ? { url: '/api/reminders/snooze-link', token: data.snooze, verb: 'snooze' }
      : event.action === 'done' && data.done && data.doneLink
        ? { url: data.doneLink, token: data.done, verb: 'mark that done' }
        : null;
  if (link) {
    // A failed button used to vanish: the card closed, nothing changed, and
    // the user believed it was handled. Say so, on a card that opens the app.
    const failed = () =>
      self.registration.showNotification('Couldn\u2019t ' + link.verb + ' \u2014 tap to open', {
        body: event.notification.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: event.notification.tag || undefined,
        data: { url: data.url || '/' },
      });
    event.waitUntil(
      fetch(link.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: link.token }),
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
