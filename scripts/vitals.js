/* Real-user performance numbers: LCP, CLS, INP, TTFB and the app's own
   "home painted" mark, from a 10% sample of production page loads, sent once
   per page via navigator.sendBeacon to POST /api/client-vitals (server log only,
   ClientVitalsController). Measured with PerformanceObserver directly — no
   web-vitals package, nothing added to the boot chunk beyond this file.

   Sent on the first pagehide / visibilitychange→hidden, because that is the
   last moment the page is guaranteed to run; LCP and CLS are only final then.
   Anonymous like error-report.js: the sign-in screen has vitals too.

   ponytail: log-only, approximate INP (the worst interaction, not the 98th
   percentile — this app rarely sees 50+ interactions on one page). Upgrade path
   is a store + percentiles server side, or the web-vitals library. */

const SAMPLE = 0.1;
const HOME_MARK = 'gb-home-painted';
let homeMarked = false;

/* Called by app.js right after the first Home render with data. The DOM is
   built at that point; the next frame is the paint, so mark there. */
export function markHomePainted() {
  if (homeMarked || typeof performance === 'undefined' || !performance.mark) return;
  homeMarked = true;
  const mark = () => {
    try {
      performance.mark(HOME_MARK);
    } catch (_) {
      /* old WebView */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(mark, 0));
  else mark();
}

function observe(type, cb, opts = {}) {
  try {
    if (
      !PerformanceObserver.supportedEntryTypes ||
      !PerformanceObserver.supportedEntryTypes.includes(type)
    )
      return;
    new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({
      type,
      buffered: true,
      ...opts,
    });
  } catch (_) {
    /* unsupported entry type */
  }
}

export function initVitals({ apiBase = '', build = 0, screen = () => '' } = {}) {
  if (import.meta.env && import.meta.env.DEV) return;
  if (typeof PerformanceObserver === 'undefined' || !navigator.sendBeacon) return;
  if (Math.random() >= SAMPLE) return;

  let lcp = 0;
  observe('largest-contentful-paint', (e) => {
    lcp = e.startTime;
  });

  // CLS: the largest session window (gaps < 1 s, window ≤ 5 s), per the spec.
  let cls = 0;
  let win = 0;
  let winFirst = 0;
  let winLast = 0;
  observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (win && e.startTime - winLast < 1000 && e.startTime - winFirst < 5000) win += e.value;
    else {
      win = e.value;
      winFirst = e.startTime;
    }
    winLast = e.startTime;
    if (win > cls) cls = win;
  });

  // INP (approx.): the slowest interaction's duration.
  let inp = 0;
  observe(
    'event',
    (e) => {
      if (e.interactionId && e.duration > inp) inp = e.duration;
    },
    { durationThreshold: 40 }
  );
  observe('first-input', (e) => {
    const d = e.processingEnd - e.startTime;
    if (d > inp) inp = d;
  });

  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    let ttfb = 0;
    let home = 0;
    let where = '';
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) ttfb = Math.max(0, nav.responseStart - (nav.activationStart || 0));
      const m = performance.getEntriesByName(HOME_MARK)[0];
      if (m) home = m.startTime;
      where = screen() || '';
    } catch (_) {
      /* partial numbers are still numbers */
    }
    const r = (n) => Math.round(n);
    const body = JSON.stringify({
      build,
      screen: String(where).slice(0, 40),
      lcp: r(lcp),
      cls: Math.round(cls * 1000) / 1000,
      inp: r(inp),
      ttfb: r(ttfb),
      home: r(home),
      conn: String((navigator.connection && navigator.connection.effectiveType) || '').slice(0, 10),
      ua: navigator.userAgent.slice(0, 200),
    });
    try {
      // A plain string goes as text/plain — a CORS-safelisted type, so the
      // Capacitor shell (a different origin) needs no preflight a beacon can't do.
      navigator.sendBeacon(apiBase + '/api/client-vitals', body);
    } catch (_) {
      /* reporting must never throw */
    }
  };
  addEventListener('pagehide', send, { capture: true });
  addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') send();
    },
    { capture: true }
  );
}
