/* =====================================================================
   Growth Buddy — Storage Utility
   Replaces localStorage with cookies + the Cache API, fronted by an
   in-memory map so reads stay synchronous (state is read at module load).

     • in-memory map  → synchronous source of truth for the session
     • cookies        → persist small values (token, session, theme, …)
                        so they survive a reload and are read synchronously
     • Cache API      → persists everything, incl. values too large for a
                        cookie (e.g. wellness photo history); hydrated into
                        the map asynchronously in init()

   Existing localStorage data is migrated out on first run so nobody loses
   their session or local data on upgrade. localStorage is not written to.
   ===================================================================== */

const PREFIX = 'gb.'; // all app keys start with this
const COOKIE_MAX = 3500; // bytes; cookies cap at ~4KB, leave headroom
const CACHE_NAME = 'gb-store-v2';
const STORE_URL = 'https://gb-store/';

// Cookies ride on EVERY request, so only a tiny, boot-critical allowlist may use
// them — otherwise accumulated app state (money, wellness, trends, …) bloats the
// request header until the server rejects it ("Request header is too large").
// Everything else persists in the Cache API only, which is never sent to the server.
function cookieEligible(key) {
  return (
    key === 'gb.token' ||
    key === 'gb.session' ||
    key === 'gb.theme' ||
    key === 'gb.apiBase' ||
    key.startsWith('gb.achSeen.') // small, needed synchronously for unlock timing
  );
}

const mem = {};

/* ---- cookie helpers (synchronous) ---- */
function setCookie(name, value) {
  try {
    // Secure flag whenever we're on HTTPS so the token cookie is never sent in cleartext.
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      encodeURIComponent(name) +
      '=' +
      encodeURIComponent(value) +
      '; path=/; max-age=31536000; SameSite=Lax' +
      secure;
  } catch (_) {
    /* ignore */
  }
}
function delCookie(name) {
  try {
    document.cookie = encodeURIComponent(name) + '=; path=/; max-age=0; SameSite=Lax';
  } catch (_) {
    /* ignore */
  }
}
function readCookies() {
  const out = {};
  try {
    (document.cookie || '').split(';').forEach((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return;
      const k = decodeURIComponent(pair.slice(0, i).trim());
      if (k.startsWith(PREFIX)) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
    });
  } catch (_) {
    /* ignore */
  }
  return out;
}
function ourCookieNames() {
  const names = [];
  try {
    (document.cookie || '').split(';').forEach((pair) => {
      const k = decodeURIComponent((pair.split('=')[0] || '').trim());
      if (k.startsWith(PREFIX)) names.push(k);
    });
  } catch (_) {
    /* ignore */
  }
  return names;
}

/* ---- Cache API helpers (async) ---- */
function cachePut(key, val) {
  if (typeof caches === 'undefined') return Promise.resolve();
  return caches
    .open(CACHE_NAME)
    .then((c) => c.put(STORE_URL + encodeURIComponent(key), new Response(val)))
    .catch(() => {});
}
function cacheDelete(key) {
  if (typeof caches === 'undefined') return Promise.resolve();
  return caches
    .open(CACHE_NAME)
    .then((c) => c.delete(STORE_URL + encodeURIComponent(key)))
    .catch(() => {});
}
function cacheReadAll() {
  if (typeof caches === 'undefined') return Promise.resolve({});
  return caches
    .open(CACHE_NAME)
    .then((c) =>
      c.keys().then((reqs) =>
        Promise.all(
          reqs.map((req) =>
            c.match(req).then((res) =>
              res
                ? res.text().then((val) => ({
                    key: decodeURIComponent(req.url.replace(STORE_URL, '')),
                    val,
                  }))
                : null
            )
          )
        )
      )
    )
    .then((entries) => {
      const out = {};
      (entries || []).forEach((e) => {
        if (e) out[e.key] = e.val;
      });
      return out;
    })
    .catch(() => ({}));
}

/* ---- synchronous hydration at module load ---- */
// 1) cookies — gives us token/session/theme immediately on boot.
Object.assign(mem, readCookies());
// 2) one-time read of legacy localStorage so existing users keep their data
//    (migrated into cookies/Cache API and cleared in init()).
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX) && !(k in mem)) mem[k] = localStorage.getItem(k);
  }
} catch (_) {
  /* localStorage unavailable — fine, we don't rely on it */
}

const CacheStorage = {
  getItem: (key) => (key in mem ? mem[key] : null),
  setItem: (key, val) => {
    const v = String(val);
    mem[key] = v;
    // Only allowlisted, boot-critical keys go to cookies; the rest are Cache-API-only
    // so they never inflate request headers.
    if (cookieEligible(key) && v.length <= COOKIE_MAX) setCookie(key, v);
    else delCookie(key);
    cachePut(key, v);
  },
  removeItem: (key) => {
    delete mem[key];
    delCookie(key);
    cacheDelete(key);
  },
  clear: () => {
    Object.keys(mem).forEach((k) => delete mem[k]);
    ourCookieNames().forEach(delCookie);
    if (typeof caches !== 'undefined') caches.delete(CACHE_NAME).catch(() => {});
  },
  /**
   * Called once at boot. Hydrates large values that live only in the Cache API
   * into the in-memory map, then finishes migrating any legacy localStorage
   * data into cookies/Cache and clears localStorage. Resolves to `true` when
   * new (not-yet-in-memory) values were pulled in, so the app can re-render.
   */
  init: () =>
    cacheReadAll().then((all) => {
      let hydrated = false;
      Object.keys(all).forEach((k) => {
        if (!(k in mem)) {
          mem[k] = all[k];
          hydrated = true;
        }
      });
      // Persist whatever we read from localStorage, then remove it for good.
      try {
        const legacy = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) legacy.push(k);
        }
        legacy.forEach((k) => {
          const v = mem[k];
          if (v != null) {
            if (cookieEligible(k) && String(v).length <= COOKIE_MAX) setCookie(k, v);
            cachePut(k, v);
          }
          localStorage.removeItem(k);
        });
      } catch (_) {
        /* ignore */
      }
      // One-time cleanup: evict any non-allowlisted cookie left over from before
      // the diet (their values already live in mem + the Cache API), so existing
      // sessions stop sending bloated headers.
      ourCookieNames().forEach((k) => {
        if (!cookieEligible(k)) delCookie(k);
      });
      return hydrated;
    }),
};

// Kept for any non-module access; the app imports the binding below.
if (typeof window !== 'undefined') window.CacheStorage = CacheStorage;

export { CacheStorage };
export default CacheStorage;
