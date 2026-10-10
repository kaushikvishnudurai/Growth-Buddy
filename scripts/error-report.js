/* Crash reporter: uncaught errors and unhandled rejections go to
   POST /api/client-errors, which writes them to the server log. Before this, a
   crash on someone's phone was invisible unless they said so.

   Deliberately tiny — no SDK, no storage, no retries. At most MAX reports per
   page load and never the same message twice, so a render loop that throws on
   every frame costs a handful of requests, not thousands (the server rate-limits
   per IP as well). Anonymous: the boot and sign-in screens crash too.

   ponytail: log-only. Upgrade path is a real tracker (Sentry etc.) — the build
   already emits nothing to symbolicate with, see vite.config.js `sourcemap`. */

const MAX = 5;
let sent = 0;
const seen = new Set();

export function initErrorReporting({ apiBase = '', build = 0, screen = () => '' } = {}) {
  // Dev has a console in front of it already.
  if (import.meta.env && import.meta.env.DEV) return;
  const send = (kind, message, stack, source) => {
    const msg = String(message || '').slice(0, 500);
    if (!msg || sent >= MAX || seen.has(msg)) return;
    // Offline, every failed fetch rejects; that is the network, not a bug.
    if (navigator.onLine === false) return;
    // Cross-origin script errors arrive with no detail at all; nothing to learn.
    if (msg === 'Script error.') return;
    seen.add(msg);
    sent++;
    let where = '';
    try {
      where = screen() || '';
    } catch (_) {
      /* state not ready */
    }
    const body = JSON.stringify({
      kind,
      message: msg,
      stack: String(stack || '').slice(0, 2000),
      source: String(source || '').slice(0, 200),
      build,
      screen: where,
      ua: navigator.userAgent.slice(0, 200),
    });
    try {
      fetch(apiBase + '/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch (_) {
      /* reporting must never throw */
    }
  };
  window.addEventListener('error', (e) => {
    const err = e.error;
    send('error', (err && err.message) || e.message, err && err.stack, e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    send('rejection', (r && r.message) || String(r), r && r.stack, '');
  });
}
