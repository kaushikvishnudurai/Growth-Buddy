/* =====================================================================
   Growth Buddy — Storage Utility
   Replaces localStorage with cookies + the Cache API, fronted by an
   in-memory map so reads stay synchronous (state is read at module load).

     • in-memory map  → synchronous source of truth for the session
     • cookies        → persist small values (token, a slim session, theme, …)
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
    // Same reason as the theme: these decide the first paint, and `state` reads
    // them synchronously at module init — long before init() hydrates the Cache
    // API. Left out, they always booted at their defaults, so the premium skin
    // and a larger text size silently reverted on every reload. Both are a
    // handful of bytes.
    key === 'gb.premium' ||
    key === 'gb.textScale' ||
    key === 'gb.apiBase'
    // gb.achSeen.<uid> used to be here: one cookie per account ever used on the
    // device. It lives in ui_prefs now; init()'s sweep of non-allowlisted cookies
    // evicts the leftovers. Their Cache API copies are dead bytes nothing reads.
  );
}

/* What a cookie holds is readable by any script on the page and rides on every
   same-origin request, so it stays as small as first paint allows:
     - the token and the session cookie live 60 days, the server's session TTL
       (every boot's /api/auth/me rewrites both, so an active device slides with
       the server); the first-paint prefs keep a year, being written only when
       changed;
     - gb.session's cookie carries only what the first render reads. Email,
       WhatsApp number, date of birth, body, diet, allergies and the token copy
       stay in memory and the Cache API, which is never sent anywhere; hydrate()
       swaps the full copy back in. An allowlist, so a new profile field stays
       out of the cookie until someone decides it must be in it. */
const YEAR_S = 31536000;
const SESSION_S = 60 * 24 * 60 * 60;
const SESSION_COOKIE_FIELDS = [
  'id',
  'displayName',
  'timezone',
  'emailVerified',
  'whatsappEnabled',
  'whatsappVerified',
  'dailyFoodGoalKcal',
  'dailyWaterGoalMl',
  'level',
  'xpTotal',
  'xpIntoLevel',
  'xpForNextLevel',
  'xpPerLevel',
  'features',
  'digestFrequency',
  'digestHour',
  'homeLayout',
  'navLayout',
  'uiPrefs',
];

/* When the slim session still won't fit (a big uiPrefs or homeLayout), the
   cookie keeps only what boot needs to open signed in. Dropping it instead put
   a valid token on the sign-in screen until the Cache API had hydrated. */
const SESSION_CORE_FIELDS = ['id', 'displayName', 'timezone', 'emailVerified', 'features'];

// setCookie stores the value URI-encoded (~1.6x for JSON), so that is what must fit.
const fits = (v) => v != null && encodeURIComponent(v).length <= COOKIE_MAX;
const pick = (u, fields) => {
  const out = {};
  fields.forEach((f) => {
    if (u[f] !== undefined) out[f] = u[f];
  });
  return JSON.stringify(out);
};

/** The value a key's cookie holds (null: no cookie). Pure, so it is testable. */
export function cookieValue(key, val) {
  if (key !== 'gb.session') return fits(val) ? val : null;
  try {
    const u = JSON.parse(val);
    if (!u || typeof u !== 'object') return null;
    const slim = pick(u, SESSION_COOKIE_FIELDS);
    if (fits(slim)) return slim;
    const core = pick(u, SESSION_CORE_FIELDS);
    return fits(core) ? core : null;
  } catch (_) {
    return null;
  }
}

/** Write `val` to `key`'s cookie, or drop the cookie when it may not hold it. */
function writeCookie(key, val) {
  const c = cookieEligible(key) ? cookieValue(key, val) : null;
  if (c != null) setCookie(key, c);
  else delCookie(key);
}

const mem = {};

/* ---- cookie helpers (synchronous) ---- */
function setCookie(name, value) {
  const maxAge = name === 'gb.token' || name === 'gb.session' ? SESSION_S : YEAR_S;
  try {
    // Secure flag whenever we're on HTTPS so the token cookie is never sent in cleartext.
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      encodeURIComponent(name) +
      '=' +
      encodeURIComponent(value) +
      '; path=/; max-age=' +
      maxAge +
      '; SameSite=Lax' +
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
// Writes to one key run one after another. Two Cache API ops are otherwise
// unordered: the timer's Reset did set-then-remove, the put landed last, and
// the discarded session came back on reload. One chain per key, for every caller.
const chains = new Map();
function serial(key, op) {
  const p = (chains.get(key) || Promise.resolve()).then(op).catch(() => {});
  chains.set(key, p);
  p.then(() => chains.get(key) === p && chains.delete(key));
  return p;
}
function cachePut(key, val) {
  if (typeof caches === 'undefined') return Promise.resolve();
  return serial(key, () =>
    caches.open(CACHE_NAME).then((c) => c.put(STORE_URL + encodeURIComponent(key), new Response(val)))
  );
}
function cacheDelete(key) {
  if (typeof caches === 'undefined') return Promise.resolve();
  return serial(key, () => caches.open(CACHE_NAME).then((c) => c.delete(STORE_URL + encodeURIComponent(key))));
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
// 1) cookies — gives us token/session/theme immediately on boot. Kept, so
//    hydrate() can tell a value still as the cookie had it (the slim session)
//    from one the app has rewritten since.
const bootCookies = readCookies();
Object.assign(mem, bootCookies);
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

/* Every tab has its own `mem`. The write queues (the outbox, the water queue,
   Money's pending ledger) are read, changed and written back whole, so a tab
   holding a stale copy wrote it back without the op another tab had queued.
   A write to one of them is broadcast, and every other tab takes it into its
   own map (persisting it is the writer's job, already done).
   ponytail: two tabs writing the same queue inside one message hop can still
   lose one op; the upgrade is navigator.locks around an async read-change-write
   of the Cache API copy, which makes the outbox async. */
const TAB_SHARED = (k) => typeof k === 'string' && (k.startsWith('gb.outbox.') || /^gb\.money\..+\.(pending|water)$/.test(k));
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gb-store') : null;
if (tabs) {
  if (tabs.unref) tabs.unref(); // node (the tests): don't hold the process open
  tabs.onmessage = (e) => {
    const { key, val } = e.data || {};
    if (!TAB_SHARED(key)) return;
    if (val == null) delete mem[key];
    else mem[key] = String(val);
  };
}
function tellTabs(key, val) {
  if (!tabs || !TAB_SHARED(key)) return;
  try {
    tabs.postMessage({ key, val });
  } catch (_) {
    /* a closed channel: this tab is going away */
  }
}

const CacheStorage = {
  getItem: (key) => (key in mem ? mem[key] : null),
  setItem: (key, val) => {
    const v = String(val);
    mem[key] = v;
    // Only allowlisted, boot-critical keys go to cookies; the rest are Cache-API-only
    // so they never inflate request headers.
    writeCookie(key, v);
    cachePut(key, v);
    tellTabs(key, v);
  },
  removeItem: (key) => {
    delete mem[key];
    delCookie(key);
    cacheDelete(key);
    tellTabs(key, null);
  },
  clear: () => {
    Object.keys(mem).forEach((k) => delete mem[k]);
    ourCookieNames().forEach(delCookie);
    if (typeof caches !== 'undefined') caches.delete(CACHE_NAME).catch(() => {});
  },
  /** Remove every key `test` accepts, from memory, cookies and the Cache API
      (including entries init() has not hydrated yet). */
  removeWhere: (test) => {
    Object.keys(mem).forEach((k) => test(k) && CacheStorage.removeItem(k));
    return cacheReadAll().then((all) =>
      Promise.all(Object.keys(all).filter(test).map(cacheDelete))
    );
  },
  /**
   * Called once at boot. Hydrates large values that live only in the Cache API
   * into the in-memory map, then finishes migrating any legacy localStorage
   * data into cookies/Cache and clears localStorage. Resolves to `true` when
   * new (not-yet-in-memory) values were pulled in, so the app can re-render.
   */
  init: () => (initP = initP || hydrate()),
  /** Resolves once init() has hydrated (starting it if nobody has). Await it
      before reading a Cache-API-only key you are about to rewrite (the
      outbox): before then it reads as absent, and a write would replace it. */
  ready: () => CacheStorage.init().catch(() => {}),
};

let initP = null;
function hydrate() {
  return cacheReadAll().then((all) => {
    let hydrated = false;
    Object.keys(all).forEach((k) => {
      // The session booted from its slim cookie: the full copy replaces it,
      // unless the app has written a fresher one meanwhile.
      const slimBoot = k === 'gb.session' && mem[k] === bootCookies[k] && all[k] !== mem[k];
      if (!(k in mem) || slimBoot) {
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
          writeCookie(k, String(v));
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
  });
}

export { CacheStorage };
export default CacheStorage;
