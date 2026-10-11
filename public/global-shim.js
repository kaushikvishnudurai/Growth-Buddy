// Loaded as a classic deferred script before the module entry (index.html). A
// file rather than an inline <script> so the Content-Security-Policy can be
// script-src 'self' (SecurityHeadersFilter) without a hash that breaks whenever
// this changes.

// sockjs-client (CommonJS) references the Node `global`, which doesn't exist in
// the browser.
window.global = window.global || window;

// The phone app holds its splash open by hand (launchAutoHide: false) until
// app.js has rendered. Anything that throws before then (a bundle built without
// VITE_API_BASE, an import that fails to evaluate) used to strand the user on
// the orange screen for good, because the backstop lived in app.js too. Armed
// here, it runs whatever app.js does: 4 s at most, at once on an uncaught error.
// hide() is idempotent, so racing the normal path is harmless. Off-device
// window.Capacitor is absent and this is a no-op.
(function () {
  var cap = window.Capacitor;
  if (!cap || !cap.nativePromise || !(cap.isNativePlatform && cap.isNativePlatform())) return;
  var hide = function () {
    try {
      var p = cap.nativePromise('SplashScreen', 'hide', {});
      if (p && p.catch) p.catch(function () {});
    } catch (_) {
      /* no splash plugin: nothing to hide */
    }
  };
  setTimeout(hide, 4000);
  window.addEventListener('error', hide);
})();
