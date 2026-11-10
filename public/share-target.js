/* "Share to Growth Buddy" from another app (the manifest's share_target, a
   POST so it can carry a picture), imported into the generated service worker
   (vite.config.js workbox.importScripts). Words go on to /?title=&text=&url=,
   which app.js already reads (launch-intent.js). A picture (a payment
   screenshot) is held here and the page is sent to /?share=image; at boot the
   page asks for it with a 'gb-share-image' message and gets the File back.
   ponytail: held in this worker's memory, not stored, so a worker the browser
   stops between the share and the page asking loses it (the page then says to
   share again); keep it in IndexedDB if that turns out to happen. */
/* global self, URL, URLSearchParams, Response */
let sharedImage = null;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData().catch(() => null);
      const file = form && form.get('image');
      if (file && typeof file !== 'string' && /^image\//.test(file.type)) {
        sharedImage = file;
        return Response.redirect('/?share=image', 303);
      }
      const q = new URLSearchParams();
      for (const k of ['title', 'text', 'url']) {
        const v = form && form.get(k);
        if (typeof v === 'string' && v.trim()) q.set(k, v);
      }
      return Response.redirect('/' + (q.toString() ? '?' + q : ''), 303);
    })()
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'gb-share-image' || !event.ports[0]) return;
  event.ports[0].postMessage({ file: sharedImage });
  sharedImage = null;
});
