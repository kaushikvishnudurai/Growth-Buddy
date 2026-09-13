/* =====================================================================
   Growth Buddy — App shell: state, routing, render
   ===================================================================== */
import {
  h,
  activate,
  AppHeader,
  BottomNav,
  NAV_CATALOG,
  resolveNavLayout,
  refreshIcons,
  Icon,
  IconChip,
  Check,
  DOMAIN,
  CrashCard,
} from './gb-kit.js';
import {
  ScreenDashboard,
  ScreenFood,
  HabitSleepInsightCard,
  RenderMiniCalendarCard,
  QuoteCard,
  HOME_WIDGETS,
  resolveHomeLayout,
} from './dashboard.js';
import {
  ScreenMoney,
  emptyMoney,
  normalizeMoney,
  mergeMoney,
  MoneyCustomisePane,
} from './money.js';
import {
  ScreenCalendar,
  RenderCalendarToolbar,
  RenderCalendarSide,
  RenderCalendarGrid,
  resetCalendarForm,
  isPastSlot,
} from './calendar.js';
import { WORK_WEEKS, getWorkWeek, setWorkWeek } from './recurrence.js';
import { ScreenAchievements, computeAchievements } from './achievements.js';
import { celebrate } from './celebrate.js';
import {
  enablePush,
  disablePush,
  pushSubscribed,
  pushSupported,
  pushTestLocal,
} from './push.js';
import { CacheStorage } from './cache-storage.js';
import {
  initNative,
  deviceLabelHeader,
  localNotificationsAvailable,
  applyNativeStatusBar,
  hideNativeSplash,
} from './native.js';
import { registerToast } from './toast.js';
import { initA11y } from './a11y.js';

// Replaced by Vite's `define` at build time — see vite.config.js.
window.GB_BUILD = __GB_BUILD__;
console.log('[gb] build', __GB_BUILD__);

// Prefer the build-time env (VITE_API_BASE). In dev, fall back to '' so requests
// are same-origin (relative) and flow through the Vite proxy to the backend.
// NOTE: no runtime (cookie-backed) override — a planted `gb.apiBase` cookie could
// otherwise redirect every API call, bearer token attached, to an attacker host.
// In dev only, still honor it for convenience.
const API_BASE = resolveApiBase();

function resolveApiBase() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  // Set-but-empty is a real answer, not a missing one: it means the API is served
  // from this same origin (the backend serving dist/), so relative paths are
  // correct and CORS never enters into it. Only an *absent* var is a mistake.
  if (env.VITE_API_BASE !== undefined && env.VITE_API_BASE !== null) {
    return env.VITE_API_BASE;
  }
  if (env.DEV) return CacheStorage.getItem('gb.apiBase') || '';

  // Production build with nothing baked in. VITE_API_BASE is read at BUILD time,
  // so there is no way to fix this after the fact — a shipped mobile binary would
  // point at the wrong host until users update. Fail where someone will see it
  // rather than sending every call, bearer token attached, to the device itself.
  const nativeShell = typeof window !== 'undefined' && !!window.Capacitor;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  if (!nativeShell && (host === 'localhost' || host === '127.0.0.1')) {
    return ''; // `vite preview`, which proxies /api to the backend
  }
  throw new Error(
    'VITE_API_BASE was not set when this bundle was built. Rebuild with ' +
      'VITE_API_BASE=https://your-api-host, or VITE_API_BASE= (empty) if the ' +
      'backend serves this bundle itself. See DEPLOYING.md.'
  );
}
const SESSION_KEY = 'gb.session';
const TOKEN_KEY = 'gb.token';
const WELLNESS_KEY_PREFIX = 'gb.wellness.';
const GOAL_PROGRESS_KEY_PREFIX = 'gb.goalProgress.';
const MONEY_KEY_PREFIX = 'gb.money.';

/* ---- Format today's date as "Wednesday, June 3" ---- */
function todayLabel() {
  try {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch (_) {
    return 'Today';
  }
}

/* ---- Greeting that knows what time it is ----
   "Hey," read identically at 6am and at midnight, which is the one thing a
   real accountability buddy would never do. This is the client's own clock, so
   it's the user's actual local time with no timezone plumbing.

   The late slot is deliberately not a greeting: past 11pm "Good evening" is
   wrong, and noticing that someone is still awake is the point. It stays warm
   rather than scolding — this app is a buddy, not a nag.

   Kept short on purpose: the home header is narrow and the name has to fit
   beside it (see .greet-name's 2-line clamp). "Good afternoon, <name>" wraps
   to three lines and truncates. */
function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 23) return 'Evening';
  return 'Still up';
}
/* People are greeted by their first name — "Morning, Kaushik", not
   "Morning, Kaushik Vishnudurai". It reads the way a person would say it, and
   it buys back the width the longer greeting costs.
   (A single long name can still hit .greet-name's 2-line clamp, exactly as it
   did with "Hey," — same second line, same break. Not made worse here.) */
function firstName() {
  const full = (state.user && state.user.displayName) || '';
  return full.trim().split(/\s+/)[0] || 'Buddy';
}

// Same dev-only self-check shape money.js uses. The wrap-around past midnight
// is the bit worth pinning: every one of the 24 hours must land somewhere.
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    const expect = (h, want) => {
      if (greetingFor(h) !== want)
        throw new Error(h + ':00 → ' + greetingFor(h) + ', want ' + want);
    };
    [0, 3, 4, 23].forEach((h) => expect(h, 'Still up'));
    [5, 9, 11].forEach((h) => expect(h, 'Morning'));
    [12, 16].forEach((h) => expect(h, 'Afternoon'));
    [17, 22].forEach((h) => expect(h, 'Evening'));
  } catch (err) {
    console.error('[greeting] self-check failed:', err.message);
  }
}

/* ---- Build a 'YYYY-MM-DD' key from y / m(0-11) / d ---- */
function dateKey(y, m, d) {
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return y + '-' + pad(m + 1) + '-' + pad(d);
}

/* ---- App state ---- */
const THEME_KEY = 'gb.theme';
function loadTheme() {
  try {
    return CacheStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch (_) {
    return 'light';
  }
}

/* ---- Premium skin ----
   One attribute on <html> swaps the whole look; styles/premium.css is scoped
   to it and loads last. Nothing else in the app branches on this — keep it
   that way, a skin that needs JS forks is not a skin. */
const PREMIUM_KEY = 'gb.premium';
function loadPremium() {
  try {
    return CacheStorage.getItem(PREMIUM_KEY) === '1';
  } catch (_) {
    return false;
  }
}
function applyPremium(on) {
  document.documentElement.setAttribute('data-premium', on ? 'on' : 'off');
}

/* ---- Text size ----
   Every font-size in the app is in rem, so setting the root size scales the whole
   interface — type, buttons, rows — in one move. This is the control an older user
   needs and the OS text-size setting alone can't give them inside a PWA. */
const TEXT_SCALE_KEY = 'gb.textScale';
const TEXT_SCALES = { normal: '100%', large: '112.5%', larger: '125%' };
function loadTextScale() {
  try {
    const v = CacheStorage.getItem(TEXT_SCALE_KEY);
    return TEXT_SCALES[v] ? v : 'normal';
  } catch (_) {
    return 'normal';
  }
}
function applyTextScale(scale) {
  const key = TEXT_SCALES[scale] ? scale : 'normal';
  // 100% means "whatever the browser/OS is set to" — don't pin it to 16px.
  document.documentElement.style.fontSize = key === 'normal' ? '' : TEXT_SCALES[key];
  return key;
}
function setTextScale(scale) {
  state.textScale = applyTextScale(scale);
  try {
    CacheStorage.setItem(TEXT_SCALE_KEY, state.textScale);
  } catch (_) {}
  saveUiPrefs({ textScale: state.textScale });
  render();
}
/* ---- Daily quote cache ----
   The "quote of the day" is stable per day, so cache the last one and show it
   instantly on reload instead of flashing the generic placeholder while the
   network request is in flight. */
const QUOTE_KEY = 'gb.quote';
function quoteDateStr() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}
function loadCachedQuote() {
  try {
    const raw = CacheStorage.getItem(QUOTE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.date === quoteDateStr() ? o.quote : null;
  } catch (_) {
    return null;
  }
}
function cacheQuote(quote) {
  try {
    if (quote) CacheStorage.setItem(QUOTE_KEY, JSON.stringify({ date: quoteDateStr(), quote }));
  } catch (_) {
    /* ignore */
  }
}

const _now = new Date();
const state = {
  theme: loadTheme(),
  premium: loadPremium(),
  textScale: loadTextScale(),
  screen: 'home',
  loading: false,
  error: '',
  errorField: '', // which auth input the error belongs under ('' = card-level)
  user: loadSession(),
  tasks: [],
  habits: [],
  goals: [],
  wellness: loadWellness(),
  goalProgress: loadGoalProgress(),
  weeklyReviews: {},
  money: loadMoney(),
  streakFreeze: loadStreakFreeze(),
  freezeTokens: 0,
  trends: loadTrends(),
  reportRange: 7, // days shown in the Report trends drill-down (7 | 30)
  water: null,
  food: null,
  quote: loadCachedQuote(),
  score: 0,
  // Auth flow: 'signin' | 'signup' | 'verify' | 'forgot' | 'reset'
  // Restore a pending verify screen across reloads so a refresh doesn't strand
  // the user on sign-in (which then makes them re-signup and burn the code).
  authMode: loadAuthDraft().mode || 'signin',
  authEmail: loadAuthDraft().email || '',
  authNotice: '',
  // Calendar / reminders
  calYear: _now.getFullYear(),
  calMonth: _now.getMonth(),
  selectedDate: dateKey(_now.getFullYear(), _now.getMonth(), _now.getDate()),
  // Flat list so recurring reminders can surface on many days.
  // { id, date:'YYYY-MM-DD', time, text, tag, repeat }
  reminders: [],
  // Cached food summaries by day key ('YYYY-MM-DD').
  calendarFoodByDate: {},
  // Per-day fetch errors for food summary panel.
  calendarFoodErrorByDate: {},
  // Day key currently being loaded for calendar panel food details.
  calendarFoodLoadingFor: '',
  // Bell-notification feed.
  notifications: [],
  notifOpen: false,
  profileOpen: false,
  moreOpen: false,
  toasts: [],
  // Network status for the offline-first PWA. `false` shows an offline banner;
  // GET requests still resolve from the service-worker cache while offline.
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
};

/* The working week decides which days a "working days" reminder lands on, so it
   has to be right for the FIRST paint — not after /api/auth/me comes back, by
   which time the calendar and Home's dots have already been drawn from the
   default. The session cache carries uiPrefs and `gb.session` is cookie-backed
   (read synchronously at module init), so it is available here. hydrateUiPrefs()
   sets it again on every refresh; this is the same value, earlier. */
setWorkWeek(state.user && state.user.uiPrefs && state.user.uiPrefs.workWeek);

let stomp = null;
let toastSeq = 0;

function dismissToast(id) {
  state.toasts = state.toasts.filter((t) => t.id !== id);
  render();
}

function pushToast(message, kind, durationMs) {
  const text = message || 'Something went wrong.';
  const toast = {
    id: ++toastSeq,
    message: text,
    kind: kind || 'error',
    at: Date.now(), // when it arrived — toastStack resumes its entrance from here
  };
  state.toasts = [...state.toasts.filter((t) => t.message !== text), toast].slice(-4);
  render();
  // Errors only. A nod has to mean "you got something done" — wiring it to
  // every success toast made it fire for "Changes saved" and even for the
  // skin toggle, which is feedback about nothing. The nod now lives on the
  // actual accomplishments (toggleTask / toggleHabit).
  if (toast.kind !== 'success') buddyReact('no');
  const duration = typeof durationMs === 'number' ? durationMs : 2800;
  setTimeout(() => dismissToast(toast.id), duration);
}

/* The header seedling nods at good news and shakes its head at bad. Hooked
   here rather than at each call site because every toast in the app — screen
   modules included, via the late-bound bridge — funnels through pushToast, so
   one hook covers all of them and none can drift out of sync.
   Must run after render(), which rebuilds the header node. */
let buddyMoodTimer = 0;
function buddyReact(mood) {
  const sprout = document.querySelector('.gb-sprout');
  if (!sprout) return;
  clearTimeout(buddyMoodTimer);
  sprout.removeAttribute('data-mood');
  void sprout.offsetWidth; // restart if the same mood fires twice in a row
  sprout.setAttribute('data-mood', mood);
  // Cleared on a timer, not animationend — in the classic skin there's no
  // animation to end, and a stuck attribute would block the next reaction.
  buddyMoodTimer = setTimeout(() => sprout.removeAttribute('data-mood'), 700);
}

function toastError(err, fallback) {
  pushToast((err && err.message) || fallback || 'Something went wrong.', 'error');
}

function toastSuccess(message) {
  pushToast(message, 'success', 1800);
}

// Hand the real implementations to the late-bound bridge that screens import.
registerToast({ success: toastSuccess, error: toastError });

function score() {
  if (state.score > 0) {
    return state.score;
  }
  let sum = 0,
    parts = 0;
  if (state.tasks.length) {
    sum += state.tasks.filter((t) => t.done).length / state.tasks.length;
    parts++;
  }
  if (state.habits.length) {
    sum += state.habits.filter((h) => h.doneToday).length / state.habits.length;
    parts++;
  }
  return parts === 0 ? 0 : Math.round((sum / parts) * 100);
}

/* score() prefers the server's number, which is exactly wrong in the moment
   after a local tick — so recompute from state with that preference switched
   off. The server's number overwrites this again a beat later. */
function optimisticScore() {
  const server = state.score;
  state.score = 0;
  const local = score();
  state.score = server;
  return local;
}

function loadSession() {
  try {
    const raw = CacheStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function loadToken() {
  try {
    return CacheStorage.getItem(TOKEN_KEY) || null;
  } catch (_) {
    return null;
  }
}

function saveSession(user, token) {
  CacheStorage.setItem(SESSION_KEY, JSON.stringify(user));
  if (token) CacheStorage.setItem(TOKEN_KEY, token);
}

function emptyWellness() {
  return { sleepByDate: {}, moodByDate: {}, photoHistory: [] };
}

function wellnessStorageKey(user) {
  const u = user || loadSession() || {};
  const id = u.id || u.email || u.displayName || 'guest';
  return WELLNESS_KEY_PREFIX + String(id);
}

function loadWellness() {
  try {
    const raw = CacheStorage.getItem(wellnessStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return Object.assign(emptyWellness(), parsed || {});
  } catch (_) {
    return emptyWellness();
  }
}

/* Local cache only — the name is the whole contract. This used to also fire
   PUT /api/daily-logs, an endpoint that has never existed (WellnessController
   exposes GET plus POST /sleep, /mood, /snapshot), so every wellness write
   logged "CRITICAL: failed to reach database" and looked like data loss. It
   wasn't: every caller already has its own working sync — saveSleepEntry POSTs
   /sleep, saveMoodEntry POSTs /mood, rememberPhotoFood POSTs /food/photo-history,
   and loadData() only writes the cache after reading from the server. */
function persistWellness() {
  try {
    CacheStorage.setItem(
      wellnessStorageKey(state.user),
      JSON.stringify(state.wellness || emptyWellness())
    );
  } catch (err) {
    console.error('⚠️ Failed to cache wellness data locally:', err);
  }
}

function goalProgressStorageKey(user) {
  const u = user || loadSession() || {};
  const id = u.id || u.email || u.displayName || 'guest';
  return GOAL_PROGRESS_KEY_PREFIX + String(id);
}

function loadGoalProgress() {
  try {
    const raw = CacheStorage.getItem(goalProgressStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function persistGoalProgress() {
  try {
    CacheStorage.setItem(
      goalProgressStorageKey(state.user),
      JSON.stringify(state.goalProgress || {})
    );
  } catch (err) {
    console.error('⚠️ Failed to cache goal progress locally:', err);
  }
  // Note: Goal progress is already persisted via updateGoalProgress() API calls.
  // This is just a local cache for offline access.
}

function updateGoalProgress(goalId, patch) {
  if (!state.goalProgress) state.goalProgress = {};
  const key = String(goalId);
  state.goalProgress[key] = Object.assign({}, state.goalProgress[key] || {}, patch);
  persistGoalProgress();
  render();
  // Persist the merged blob to the backend (optimistic; cache already updated).
  api('/api/goals/' + encodeURIComponent(goalId) + '/progress', {
    method: 'PUT',
    body: JSON.stringify(state.goalProgress[key]),
  }).catch((err) => {
    console.error('❌ CRITICAL: updateGoalProgress failed to reach database:', err);
  });
}

/* ---- Money Buddy — stored server-side as one JSON doc (GET/PUT /api/money),
   with a local CacheStorage mirror for instant paint + offline (PWA). ---- */
function moneyStorageKey(user) {
  const u = user || loadSession() || {};
  const id = u.id || u.email || u.displayName || 'guest';
  return MONEY_KEY_PREFIX + String(id);
}

function loadMoney() {
  try {
    const raw = CacheStorage.getItem(moneyStorageKey());
    return normalizeMoney(raw ? JSON.parse(raw) : null);
  } catch (_) {
    return emptyMoney();
  }
}

function cacheMoney() {
  try {
    CacheStorage.setItem(moneyStorageKey(state.user), JSON.stringify(state.money));
  } catch (err) {
    console.error('⚠️ Failed to cache money data locally:', err);
  }
}

// The whole money doc is PUT on every edit, so two writes in flight at once can land
// out of order and leave the server holding the older blob — losing the newer expense.
// Chaining them keeps the last write on the wire the last write to the database.
let moneySaveQueue = Promise.resolve();

/* The version of the money document this tab last saw, from the ETag. Sent back
   as If-Match so the server can refuse a write based on a copy someone else has
   already replaced. The queue above only ever ordered THIS tab's writes; a phone
   and a laptop editing the same evening had nothing between them. */
let moneyVersion = null;

function rememberMoneyVersion(res) {
  const tag = res && res.headers && res.headers.get('ETag');
  if (tag) moneyVersion = tag;
}

async function putMoney(body, version) {
  return api('/api/money', {
    method: 'PUT',
    body,
    headers: version ? { 'If-Match': version } : {},
    onResponse: rememberMoneyVersion,
  });
}

function saveMoney(next) {
  // Optimistic: update local + cache + repaint immediately, then persist to the
  // server (mirrors saveHomeLayout). Offline writes still land in the cache.
  state.money = normalizeMoney(next);
  cacheMoney();
  render();
  const body = JSON.stringify(state.money);
  // CRITICAL: This MUST reach the database. Log all failures prominently.
  moneySaveQueue = moneySaveQueue.then(() =>
    putMoney(body, moneyVersion)
      .catch(async (err) => {
        if (err && err.status === 409) {
          // Someone else wrote first. Take their copy, fold ours into it, and
          // write once more — unconditionally, so a third writer can't spin this.
          const theirs = await api('/api/money', { onResponse: rememberMoneyVersion });
          state.money = mergeMoney(state.money, theirs);
          cacheMoney();
          render();
          toastSuccess('Merged money changes from your other device.');
          return putMoney(JSON.stringify(state.money), null);
        }
        throw err;
      })
      .catch((err) => {
      console.error('❌ CRITICAL: saveMoney failed to reach database:', err);
      toastError(err, '❌ Money data NOT saved to database. Check your connection and try again.');
    })
  );
}

/* ---- UI preferences (theme, quick-add language, onboarding-dismissed,
   celebrated achievements) — persisted server-side on the user row via
   PUT /api/auth/ui-prefs, with the existing per-key CacheStorage entries kept
   as a synchronous mirror for the views that read them. The DB is the source
   of truth so these follow the user across devices; the cache is just the fast
   local read path. ponytail: one JSON blob + mirror, exactly like saveMoney. */
function saveUiPrefs(patch) {
  if (!state.user || !patch) return;
  state.user.uiPrefs = Object.assign({}, state.user.uiPrefs || {}, patch);
  // Mirror into the cached session too. That cache is what the app boots from,
  // and it was only ever refreshed by /api/auth/me — so a pref saved here read
  // back at its OLD value on the next reload, until some later request happened
  // to refresh the user. Caught by the working week, where a stale value means
  // the calendar draws the wrong days; it was equally wrong for the rest.
  saveSession(state.user, state.user.token);
  api('/api/auth/ui-prefs', {
    method: 'PUT',
    body: JSON.stringify({ prefs: state.user.uiPrefs }),
  }).catch((err) => {
    console.error('❌ CRITICAL: saveUiPrefs failed to reach database:', err);
  });
}

/* On login / user refresh, mirror the server's stored UI prefs into the local
   cache keys the views read synchronously, so a fresh device paints the user's
   real theme/onboarding/etc. instead of defaults. */
function hydrateUiPrefs() {
  const p = state.user && state.user.uiPrefs;
  if (!p) return;
  try {
    if (p.theme === 'dark' || p.theme === 'light') {
      state.theme = p.theme;
      CacheStorage.setItem(THEME_KEY, p.theme);
      applyTheme(p.theme);
    }
    if (TEXT_SCALES[p.textScale]) {
      state.textScale = applyTextScale(p.textScale);
      CacheStorage.setItem(TEXT_SCALE_KEY, p.textScale);
    }
    if (typeof p.premium === 'boolean') {
      state.premium = p.premium;
      CacheStorage.setItem(PREMIUM_KEY, p.premium ? '1' : '0');
      applyPremium(p.premium);
    }
    if (typeof p.qaLang === 'string') localStorage.setItem('gb.qa.lang', p.qaLang);
    // Before this runs, every "Mon-Fri" reminder answers with the default —
    // so it has to happen before the calendar or Home paints their dots.
    setWorkWeek(p.workWeek);
    if (p.onboardingDone) CacheStorage.setItem('gb.onboardDismissed', '1');
    if (Array.isArray(p.achSeen)) {
      CacheStorage.setItem('gb.achSeen.' + (state.user.id || 'me'), JSON.stringify(p.achSeen));
    }
  } catch (_) {
    /* silent — cache mirror is best-effort */
  }
}

/* ---- Streak freeze / rest days (backend-backed) ----
   The backend owns freeze tokens (1 granted per ISO week, capped) and treats a
   "protected" day — a planned rest day or a rescued miss — as a bridge that
   keeps a daily streak alive instead of resetting it. Each habit payload carries
   the already-protected `streak`, `atRisk`/`riskStreak` (a recent miss the user
   can still rescue), `protectedToday`, and the current `freezeTokens` balance.
   This layer just reads those fields and calls the protect/unprotect endpoints. */

function todayKey() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

// At-risk banners the user chose to let reset — session-only, don't nag again.
const dismissedRisk = new Set();

// Back-compat stubs: state still initialises/clears `streakFreeze`, but the
// freeze data now lives on the server (per-habit fields + the token balance).
function emptyStreakFreeze() {
  return {};
}
function loadStreakFreeze() {
  return emptyStreakFreeze();
}

/* Sync the token balance from the latest habits payload (each habit echoes it). */
function reconcileStreakFreeze() {
  const h = (state.habits || []).find((x) => typeof x.freezeTokens === 'number');
  if (h) state.freezeTokens = h.freezeTokens;
}

function effectiveStreak(habit) {
  return Number(habit.streak) || 0;
}

/* Inputs the achievement engine reads. Shared by the Achievements screen and
   the first-unlock detector so both see identical numbers. */
function achievementProps() {
  return {
    user: state.user,
    topStreak: (state.habits || []).reduce((mx, hb) => Math.max(mx, effectiveStreak(hb)), 0),
    goals: state.goals,
    wellness: state.wellness,
    trends: state.trends,
    food: state.food,
    water: state.water,
  };
}

/* Fire a grand celebration the FIRST time each achievement unlocks. We keep a
   per-user list of already-celebrated ids in storage; on the first run after a
   full data load we baseline it silently (so pre-earned badges don't all pop),
   then celebrate anything new that crosses its threshold thereafter. */
function checkAchievements() {
  if (!state.user || !state.achReady) return;
  const seenKey = 'gb.achSeen.' + (state.user.id || 'me');
  let all;
  try {
    all = computeAchievements(achievementProps()).flatMap((g) => g.items);
  } catch (_) {
    return;
  }
  const unlockedIds = all.filter((i) => i.unlocked).map((i) => i.id);

  let seen = null;
  try {
    const raw = CacheStorage.getItem(seenKey);
    seen = raw ? JSON.parse(raw) : null;
  } catch (_) {
    seen = null;
  }
  if (!Array.isArray(seen)) {
    // First run with real data — baseline, don't celebrate the back-catalogue.
    CacheStorage.setItem(seenKey, JSON.stringify(unlockedIds));
    saveUiPrefs({ achSeen: unlockedIds });
    return;
  }
  const seenSet = new Set(seen);
  const fresh = all.filter((i) => i.unlocked && !seenSet.has(i.id));
  if (!fresh.length) return;
  // Persist the union BEFORE celebrating so a re-render mid-animation can't
  // double-fire the same badge.
  const union = Array.from(new Set([...seen, ...unlockedIds]));
  CacheStorage.setItem(seenKey, JSON.stringify(union));
  saveUiPrefs({ achSeen: union });
  fresh.forEach((item) => celebrate(item));
}

/* Card-facing view of a habit's freeze state, shaped like the old local model. */
function habitFreezeState(habit) {
  return {
    pendingBreak: !!habit.atRisk && !dismissedRisk.has(String(habit.id)),
    brokenFrom: Number(habit.riskStreak) || 0,
    frozen: habit.protectedToday ? ['today'] : [],
  };
}

function freezeTokensLeft() {
  return Number(state.freezeTokens) || 0;
}

/* Spend a freeze to rescue yesterday's missed day and keep the streak alive. */
async function protectStreak(habitId) {
  try {
    const updated = await api('/api/habits/' + encodeURIComponent(habitId) + '/protect', {
      method: 'POST',
      body: JSON.stringify({ date: yesterdayKey() }),
    });
    state.habits = state.habits.map((h) => (h.id === updated.id ? updated : h));
    reconcileStreakFreeze();
    toastSuccess('Streak protected with a freeze.');
    render();
  } catch (err) {
    toastError(err, 'Could not protect your streak.');
  }
}

/* Dismiss the at-risk prompt and let the streak reset (no token spent). */
function declineStreakBreak(habitId) {
  dismissedRisk.add(String(habitId));
  render();
}

/* Proactively mark today as a rest day (spends a token), or undo it (refunds). */
async function toggleRestDay(habitId, makeRest) {
  try {
    const path = makeRest ? '/protect' : '/unprotect';
    const updated = await api('/api/habits/' + encodeURIComponent(habitId) + path, {
      method: 'POST',
      body: JSON.stringify({ date: todayKey() }),
    });
    state.habits = state.habits.map((h) => (h.id === updated.id ? updated : h));
    reconcileStreakFreeze();
    toastSuccess(makeRest ? 'Rest day set — your streak holds.' : 'Rest day removed.');
    render();
  } catch (err) {
    toastError(err, makeRest ? 'Could not set a rest day.' : 'Could not remove the rest day.');
  }
}

/* ---- Trends — local daily time-series for the Report drill-down ----
   The backend only exposes today's score/water/food, so (per the frontend-first
   plan) we keep a small per-user daily history client-side, like `wellness`.
   Mood & sleep already live in `wellness` keyed by date; here we snapshot
   score, water and calories once per day so the Report screen can chart
   weekly/monthly trends. Trimmed to a rolling window to stay small. */
const TRENDS_KEY_PREFIX = 'gb.trends.';
const TRENDS_MAX_DAYS = 120;

function emptyTrends() {
  return { byDate: {} };
}

function trendsStorageKey(user) {
  const u = user || loadSession() || {};
  const id = u.id || u.email || u.displayName || 'guest';
  return TRENDS_KEY_PREFIX + String(id);
}

function loadTrends() {
  try {
    const raw = CacheStorage.getItem(trendsStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return Object.assign(emptyTrends(), parsed || {});
  } catch (_) {
    return emptyTrends();
  }
}

function persistTrends() {
  try {
    CacheStorage.setItem(
      trendsStorageKey(state.user),
      JSON.stringify(state.trends || emptyTrends())
    );
  } catch (_) {
    /* silent */
  }
}

/* Snapshot today's headline numbers into the local history (called after a
   data load, when state.score / water / food are fresh). */
function recordTrendsToday() {
  if (!state.trends) state.trends = emptyTrends();
  if (!state.trends.byDate) state.trends.byDate = {};
  const key = todayKey();
  state.trends.byDate[key] = {
    date: key,
    score: Number(state.score) || 0,
    waterMl: (state.water && state.water.consumedMl) || 0,
    waterGoalMl: (state.water && state.water.goalMl) || 0,
    kcal: (state.food && state.food.totalCalories) || 0,
  };
  const keys = Object.keys(state.trends.byDate).sort();
  if (keys.length > TRENDS_MAX_DAYS) {
    keys.slice(0, keys.length - TRENDS_MAX_DAYS).forEach((k) => delete state.trends.byDate[k]);
  }
  persistTrends();
  // Persist today's snapshot to the backend (fire-and-forget; cache already set).
  api('/api/daily-logs/snapshot', {
    method: 'POST',
    body: JSON.stringify(state.trends.byDate[key]),
  }).catch((err) => {
    console.error('❌ CRITICAL: recordTrendsToday snapshot failed to reach database:', err);
  });
}

function clearSession() {
  CacheStorage.removeItem(SESSION_KEY);
  CacheStorage.removeItem(TOKEN_KEY);
}

/* The ONLY way a signed-in user reaches `state` — sign-in, OTP verify, password
   reset and every profile save all come through here, because this is where
   hydrateUiPrefs() runs. Set `state.user` directly and the account's theme, text
   size and premium skin stay at this device's defaults until something else
   happens to call /api/auth/me.

   A token on the payload wins over the stored one: at sign-in nothing is stored
   yet, and after a password change the stored one has just been revoked. */
function syncUserSession(userPatch) {
  const token = (userPatch && userPatch.token) || loadToken();
  state.user = Object.assign({}, state.user || {}, userPatch || {});
  if (token) {
    state.user.token = token;
  }
  saveSession(state.user, token);
  hydrateUiPrefs();
}

// In-flight dedup for idempotent GETs: if the same GET is already running,
// hand back the same promise instead of opening a second connection. Cleared
// the moment it settles, so this collapses concurrent duplicates without ever
// serving stale data (it is not a cache). Mutations always bypass it.
const _inflightGets = new Map();

async function api(path, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET' && !opts.body) {
    const existing = _inflightGets.get(path);
    if (existing) return existing;
    const p = (async () => {
      try {
        return await apiFetch(path, opts);
      } finally {
        _inflightGets.delete(path);
      }
    })();
    _inflightGets.set(path, p);
    return p;
  }
  return apiFetch(path, opts);
}

/* Fallback when a failed response carries no JSON message of its own — a
   gateway's HTML page, an empty body. A bare status code is not an error
   message; 502/503/504 from Render's proxy specifically mean the free instance
   is asleep and waking, which is a "try again in a moment", not a fault. */
function statusMessage(status) {
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is waking up. Give it a moment and try again.';
  }
  if (status === 429) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (status >= 500) {
    return 'Something went wrong. Please try again.';
  }
  return "That didn't work. Please try again.";
}

async function apiFetch(path, options) {
  const opts = options || {};
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  const token = loadToken();
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  // Lets the signed-in-devices list say "Growth Buddy on SM-S918B" instead of
  // guessing from a User-Agent that no longer carries the model.
  const device = deviceLabelHeader();
  if (device) {
    headers['X-GB-Device'] = device;
  }
  if (opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
  } catch (_) {
    throw new Error('Cannot reach the server. Make sure Growth Buddy is running, then try again.');
  }
  if (res.status === 401) {
    // Token went stale (revoked, expired, server restarted with empty DB,
    // etc.) — wipe local state and bounce to the sign-in screen.
    handleAuthExpired();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!res.ok) {
    let msg = statusMessage(res.status);
    try {
      const err = await res.json();
      msg = err.message || msg;
    } catch (_) {
      // ignored
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (typeof opts.onResponse === 'function') {
    opts.onResponse(res);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

function handleAuthExpired() {
  disconnectWebSocket();
  clearSession();
  state.user = null;
  state.tasks = [];
  state.habits = [];
  state.goals = [];
  state.reminders = [];
  state.goals = [];
  state.wellness = emptyWellness();
  state.goalProgress = {};
  state.money = emptyMoney();
  state.streakFreeze = emptyStreakFreeze();
  state.trends = emptyTrends();
  state.water = null;
  state.food = null;
  state.calendarFoodByDate = {};
  state.calendarFoodErrorByDate = {};
  state.calendarFoodLoadingFor = '';
  state.notifications = [];
  state.quote = null;
  state.score = 0;
  state.authMode = 'signin';
  state.authEmail = '';
  try {
    sessionStorage.removeItem('gb.authDraft');
  } catch (_) {
    /* ignore */
  }
  state.authNotice = 'Your session ended. Sign in again.';
  state.profileOpen = false;
  state.notifOpen = false;
  state.moreOpen = false;
  state.toasts = [];
  state.screen = 'home';
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  render();
}

function formatTaskTime(task) {
  const isOverdue = !task.done && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  // Only worth saying for a task finished more than once (a recurring one that
  // has come round again). "Completed - done 1x" told you the same thing twice
  // and used a hyphen where every other line in the app uses a middot.
  const suffix = task.completionCount > 1 ? ' · done ' + task.completionCount + '×' : '';
  if (task.dueAt) {
    try {
      const dt = new Date(task.dueAt);
      const base =
        dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' · ' +
        dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return (isOverdue ? 'Overdue · ' : '') + base + suffix;
    } catch (_) {
      return (isOverdue ? 'Overdue' : 'Scheduled') + suffix;
    }
  }
  return (task.done ? 'Completed' : 'No due time') + suffix;
}

function mapTask(task) {
  return {
    id: task.id,
    title: task.title,
    time: formatTaskTime(task),
    priority:
      !task.done && task.dueAt && new Date(task.dueAt).getTime() < Date.now()
        ? 'High'
        : task.priority || 'Medium',
    done: !!task.done,
    dueAt: task.dueAt || null,
    doneAt: task.doneAt || null,
    completionCount: task.completionCount || 0,
  };
}

function cacheFoodSummary(summary) {
  if (!summary || !summary.date) {
    return;
  }
  state.calendarFoodByDate[summary.date] = summary;
  delete state.calendarFoodErrorByDate[summary.date];
}

async function loadCalendarFoodForDate(dayKey, options) {
  const opts = options || {};
  if (!state.user || !dayKey || (state.calendarFoodByDate[dayKey] && !opts.force)) {
    return;
  }
  delete state.calendarFoodErrorByDate[dayKey];
  state.calendarFoodLoadingFor = dayKey;
  rerenderCalendarSideIfActive();
  rerenderHomeMiniCalendarIfActive();
  try {
    const summary = await api('/api/food?date=' + encodeURIComponent(dayKey));
    cacheFoodSummary(summary);
  } catch (err) {
    state.calendarFoodErrorByDate[dayKey] =
      err && err.message ? err.message : 'Could not load food entries for this day.';
  } finally {
    if (state.calendarFoodLoadingFor === dayKey) {
      state.calendarFoodLoadingFor = '';
    }
    rerenderCalendarSideIfActive();
    rerenderHomeMiniCalendarIfActive();
  }
}

/**
 * Replace only the right-hand calendar side panel in place. The form
 * DOM is module-cached inside calendar.js, so the user's in-progress
 * reminder text / tag / repeat survives. Falls back to a full render
 * if we can't find the panel in the DOM (different screen, first paint).
 */
function rerenderCalendarSideIfActive() {
  if (state.screen !== 'calendar') return;
  const oldSide = document.querySelector('.gb-cal-side');
  if (!oldSide || !RenderCalendarSide) {
    render();
    return;
  }
  const newSide = RenderCalendarSide({
    selectedDate: state.selectedDate,
    reminders: state.reminders,
    tasks: state.tasks,
    goals: state.goals,
    wellness: state.wellness,
    foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
    dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
    dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
    onRetryFood: retryCalendarFoodDate,
    onAddReminder: addReminder,
    onDeleteReminder: deleteReminder,
  });
  oldSide.replaceWith(newSide);
  refreshIcons();
}

function rerenderHomeMiniCalendarIfActive() {
  if (state.screen !== 'home') return false;
  const oldCard = document.querySelector('.gb-mini-cal-card');
  if (!oldCard || !RenderMiniCalendarCard) {
    return false;
  }
  const fresh = RenderMiniCalendarCard({
    tasks: state.tasks,
    reminders: state.reminders,
    foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
    dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
    dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
    calYear: state.calYear,
    calMonth: state.calMonth,
    selectedDate: state.selectedDate,
    onSelectDate: selectDate,
    onPrevMonth: calPrevMonth,
    onNextMonth: calNextMonth,
    onRetryFood: retryCalendarFoodDate,
  });
  oldCard.replaceWith(fresh);
  refreshIcons();
  return true;
}

/**
 * Update the `is-selected` / aria-pressed state on the month grid in
 * place — no DOM rebuild, no flicker.
 */
function updateCalendarDaySelection(newKey) {
  const cells = document.querySelectorAll('.gb-cal-day[data-day-key]');
  cells.forEach((el) => {
    const k = el.getAttribute('data-day-key');
    const on = k === newKey;
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

async function resetStaleCompletedTasks(tasks) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const stale = tasks.filter((t) => t.done && t.doneAt && new Date(t.doneAt) < start);
  if (!stale.length) {
    return tasks;
  }

  const updatedPairs = await Promise.all(
    stale.map(async (t) => {
      try {
        const updated = await api('/api/tasks/' + encodeURIComponent(t.id), {
          method: 'PUT',
          body: JSON.stringify({ done: false }),
        });
        return [t.id, updated];
      } catch (_) {
        return [t.id, t];
      }
    })
  );

  const byId = Object.fromEntries(updatedPairs);
  return tasks.map((t) => byId[t.id] || t);
}

/* Boot in two waves.

   Every one of the twelve calls used to sit in one Promise.all behind the
   loading splash, so the slowest gated first paint — including `/api/money`
   (a blob up to 512 kB) and `/api/daily-logs?days=60`, neither of which Home
   needs to draw. `/api/weekly-review` was worse: awaited *after* the
   Promise.all, a whole extra round trip in series.

   Wave 1 is only what Home can't paint without. Wave 2 is everything else,
   fired in parallel and folded in when it lands — safe because every state
   field has a cache-backed or empty default (see the `state` initialiser), so
   the first paint shows cached values and corrects itself rather than
   rendering blanks. */
async function loadData() {
  if (!state.user) {
    return;
  }
  state.loading = true;
  state.error = '';
  render();
  // Not awaited, and deliberately not in wave 2: the quote is the only thing on
  // the loading screen that isn't a grey box, and wave 2 doesn't start until all
  // five wave-1 calls have landed — so on a slow connection the request wasn't
  // even in flight while the skeleton was up, and the card sat on its hardcoded
  // fallback every time. It's a tiny payload; let it race.
  loadQuote();
  try {
    const [tasksRaw, habits, todayScore, water, reminders] = await Promise.all([
      api('/api/tasks'),
      api('/api/habits'),
      api('/api/score/today'),
      api('/api/water'),
      api('/api/reminders'),
    ]);
    const tasks = await resetStaleCompletedTasks(tasksRaw);
    state.tasks = tasks.map(mapTask);
    state.habits = habits;
    reconcileStreakFreeze();
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : 0;
    state.water = water;
    state.reminders = reminders;
  } catch (err) {
    state.error = err.message || 'Failed to load data from backend.';
    state.loading = false;
    render();
    return;
  }
  state.loading = false;
  render(); // <- first paint happens here, on five calls instead of twelve
  loadSecondaryData();
}

/* Quote of the day. Own function because it's the one call that starts before
   wave 1 rather than after it. */
function loadQuote() {
  api('/api/quotes/today')
    .then((quote) => {
      if (!quote) return;
      state.quote = quote;
      cacheQuote(quote);
      // Repaint only where the quote is on screen. A blind render() here would
      // rebuild screens that own their subtree (money, family, mentor, circle)
      // and throw away their local view state.
      if (state.loading || state.screen === 'home') render();
    })
    .catch(() => {
      /* the card falls back to its own copy */
    });
}

/* Wave 2: nothing here gates first paint. Never throws into the UI — a failure
   leaves Home standing on wave-1 data rather than replacing it with a crash. */
async function loadSecondaryData() {
  // The screen we painted. If the user has navigated by the time this resolves,
  // skip the repaint: their screen was built with this data already in state,
  // and re-rendering would rebuild screens that own their subtree (family,
  // money, mentor, circle) and throw away their local view state.
  const bootScreen = state.screen;
  connectWebSocket();
  try {
    const [goals, notifications, food, money, dailyLogs, photoHistory, weekly] =
      await Promise.all([
        api('/api/goals').catch(() => null),
        api('/api/notifications').catch(() => null),
        api('/api/food').catch(() => null),
        api('/api/money', { onResponse: rememberMoneyVersion }).catch((err) => {
          console.error('Money API failed - data will NOT persist!', err);
          return null;
        }),
        api('/api/daily-logs?days=60').catch((err) => {
          console.error('Daily logs API failed - sleep/mood data will NOT persist!', err);
          return null;
        }),
        api('/api/food/photo-history').catch((err) => {
          console.error('Photo history API failed - photos will NOT persist!', err);
          return null;
        }),
        api('/api/weekly-review').catch(() => null),
      ]);

    if (goals) {
      state.goals = goals;
      // Per-goal progress (milestones, day-tracker) rides on each goal from the
      // backend; rebuild the id-keyed map and mirror it to the local cache.
      const gp = {};
      goals.forEach((sec) =>
        (sec.goals || []).forEach((g) => {
          if (g && g.progress) gp[String(g.id)] = g.progress;
        })
      );
      state.goalProgress = gp;
      persistGoalProgress();
    }
    if (notifications) state.notifications = notifications;
    if (food) {
      state.food = food;
      cacheFoodSummary(food);
    }
    if (money) {
      state.money = normalizeMoney(money);
      cacheMoney();
    }
    // Sleep/mood + trends live on the backend. Merge in the server data, keep
    // the local-only photo history, and mirror to cache for offline paint.
    if (dailyLogs) {
      const localWell = loadWellness();
      state.wellness = {
        sleepByDate: dailyLogs.sleepByDate || {},
        moodByDate: dailyLogs.moodByDate || {},
        photoHistory: photoHistory != null ? photoHistory : localWell.photoHistory || [],
      };
      state.trends = { byDate: dailyLogs.byDate || {} };
      persistWellness();
      persistTrends();
    } else if (photoHistory != null) {
      state.wellness = Object.assign(emptyWellness(), state.wellness || {}, { photoHistory });
      persistWellness();
    }
    if (weekly) {
      const map = {};
      weekly.forEach((w) => {
        map[w.weekStart] = { wins: w.wins, focus: w.focus, savedAt: w.savedAt };
      });
      state.weeklyReviews = map;
    }

    loadCalendarFoodForDate(state.selectedDate);
    // Needs state.food, so it can only run once wave 2 has landed.
    recordTrendsToday();
    // Data is complete now, so achievement detection can baseline/fire safely.
    state.achReady = true;

    // Push the cached money blob up in case it was only ever saved locally. The
    // wellness half of this used to sit here and did nothing but fail: it PUT to
    // /api/daily-logs, which doesn't exist, and sent data the server had just
    // returned.
    setTimeout(() => {
      if (state.money) {
        api('/api/money', { method: 'PUT', body: JSON.stringify(state.money) }).catch((err) =>
          console.error('Money sync failed:', err)
        );
      }
    }, 100);

    if (state.screen === bootScreen) render();
  } catch (err) {
    console.error('Secondary data load failed', err);
  }
}

/* ---- WebSocket: realtime notification push ---- */
/* Realtime bell notifications. `sockjs-client` + `@stomp/stompjs` + their
   `url-parse` dependency are ~155 KB of source — 15% of the bundle — and they
   exist for this one channel. They're imported dynamically so they land after
   first paint instead of blocking it: nothing awaits this call, and a channel
   that opens a few hundred ms late is invisible.
   `connecting` guards the await window — without it two calls in quick
   succession both pass the `stomp` check before either has assigned it. */
let wsConnecting = false;

async function connectWebSocket() {
  if (!state.user || stomp || wsConnecting) return;
  const token = loadToken();
  if (!token) return;
  wsConnecting = true;
  try {
    const [{ default: SockJS }, { Client: StompClient }] = await Promise.all([
      import('sockjs-client'),
      import('@stomp/stompjs'),
    ]);
    // Logged out (or already connected) while the chunks were in flight.
    if (!state.user || stomp) return;
    stomp = new StompClient({
      webSocketFactory: () => new SockJS(API_BASE + '/ws'),
      connectHeaders: { Authorization: 'Bearer ' + token },
      reconnectDelay: 5000,
      onConnect: () => {
        stomp.subscribe('/user/queue/notifications', (frame) => {
          try {
            const n = JSON.parse(frame.body);
            state.notifications = [n, ...state.notifications.filter((x) => x.id !== n.id)];
            render();
          } catch (e) {
            console.warn('Bad notification frame', e);
          }
        });
      },
      onStompError: (f) => console.warn('STOMP error', f.headers, f.body),
    });
    stomp.activate();
  } catch (err) {
    console.warn('WebSocket setup failed', err);
  } finally {
    wsConnecting = false;
  }
}

function disconnectWebSocket() {
  if (stomp) {
    try {
      stomp.deactivate();
    } catch (_) {}
    stomp = null;
  }
}

/* Paint the tick, then tell the server. The round trip is three calls deep
   (toggle -> score -> /me), so awaiting it left the checkbox looking dead for
   most of a second. `before` is the rollback if any of them fails. */
async function toggleTask(id) {
  const before = { tasks: state.tasks, score: state.score };
  state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  state.score = optimisticScore();
  render();
  const nowDone = state.tasks.some((t) => t.id === id && t.done);
  // Only on the way to done. Un-ticking something is a correction, not an
  // achievement, and nodding at it would make the nod meaningless.
  if (nowDone) buddyReact('yes');
  try {
    const updated = await api('/api/tasks/' + encodeURIComponent(id) + '/toggle', {
      method: 'PATCH',
    });
    state.tasks = state.tasks.map((t) => (t.id === updated.id ? mapTask(updated) : t));
    const todayScore = await api('/api/score/today');
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
    await refreshCurrentUser();
    render();
  } catch (err) {
    state.tasks = before.tasks;
    state.score = before.score;
    render();
    toastError(err, 'Could not toggle task.');
  }
}

/* Same optimistic paint as toggleTask — same three-call round trip. Streak
   numbers are the server's to decide, so only `doneToday` flips locally. */
async function toggleHabit(id) {
  const before = { habits: state.habits, score: state.score };
  state.habits = state.habits.map((h) => (h.id === id ? { ...h, doneToday: !h.doneToday } : h));
  state.score = optimisticScore();
  render();
  if (state.habits.some((h) => h.id === id && h.doneToday)) buddyReact('yes');
  try {
    const updated = await api('/api/habits/' + encodeURIComponent(id) + '/toggle', {
      method: 'PATCH',
    });
    state.habits = state.habits.map((h) => (h.id === updated.id ? updated : h));
    reconcileStreakFreeze();
    const todayScore = await api('/api/score/today');
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
    await refreshCurrentUser();
    render();
  } catch (err) {
    state.habits = before.habits;
    state.score = before.score;
    render();
    toastError(err, 'Could not toggle habit.');
  }
}

async function refreshScore() {
  try {
    const s = await api('/api/score/today');
    if (s && typeof s.score === 'number') state.score = s.score;
  } catch (_) {
    /* silent */
  }
}

async function refreshCurrentUser() {
  try {
    const me = await api('/api/auth/me');
    syncUserSession(me || {});
  } catch (_) {
    /* silent */
  }
}

async function createTask(body) {
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  state.tasks = [mapTask(created), ...state.tasks];
  await refreshScore();
}

async function updateTask(id, body) {
  const updated = await api('/api/tasks/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  state.tasks = state.tasks.map((t) => (t.id === updated.id ? mapTask(updated) : t));
  await refreshScore();
}

async function createHabit(body) {
  const created = await api('/api/habits', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  state.habits = [created, ...state.habits];
  await refreshScore();
}

/* ---- Natural-language quick-add ----
   Send the raw text (+ the user's habit names for matching) to the backend
   parser, then apply each returned intent using the same handlers the manual
   UI uses. Returns a summary so the caller can confirm what landed. */
function sleepPayloadFromHours(hours, quality) {
  // Synthesize a bedtime/wake around a 07:00 wake so the logged duration is right.
  const wake = 7 * 60;
  let bed = (((wake - Math.round(hours * 60)) % 1440) + 1440) % 1440;
  const fmt = (m) =>
    String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  return {
    bedtime: fmt(bed),
    wakeTime: '07:00',
    quality: quality === 'ok' ? 'okay' : quality || 'okay',
    note: '',
  };
}
function addQuickExpense(amount, note) {
  const next = normalizeMoney(state.money);
  next.expenses.unshift({
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    amount: Math.round(amount),
    category: 'others',
    date: todayKeyNow(),
    note: note || '',
    createdAt: Date.now(),
  });
  saveMoney(next);
}
async function runQuickAdd(text) {
  const habits = (state.habits || [])
    .map((hb) => hb.name)
    .filter(Boolean)
    .slice(0, 100);
  const res = await api('/api/quick-add', {
    method: 'POST',
    body: JSON.stringify({ text, habits }),
  });
  if (!res || res.configured === false) return { configured: false, applied: 0 };
  const intents = res.intents || [];
  let applied = 0;
  for (const it of intents) {
    try {
      if (it.type === 'task' && it.title) {
        await createTask({ title: it.title });
        applied++;
      } else if (it.type === 'habit' && it.name) {
        const hb = (state.habits || []).find(
          (x) => (x.name || '').toLowerCase() === it.name.toLowerCase()
        );
        if (hb && !hb.doneToday) await toggleHabit(hb.id);
        if (hb) applied++;
      } else if (it.type === 'water' && it.amountMl) {
        await quickAddWater(it.amountMl);
        applied++;
      } else if (it.type === 'sleep' && it.hours) {
        await saveSleepEntry(sleepPayloadFromHours(it.hours, it.quality));
        applied++;
      } else if (it.type === 'mood' && it.mood) {
        await saveMoodEntry({ mood: it.mood, energy: it.energy || 'medium' });
        applied++;
      } else if (it.type === 'expense' && it.amount) {
        addQuickExpense(it.amount, it.note);
        applied++;
      }
    } catch (_) {
      /* skip a single bad intent; keep applying the rest */
    }
  }
  return { configured: true, applied, note: res.note, total: intents.length };
}

async function loadGoals() {
  try {
    state.goals = await api('/api/goals');
    render();
  } catch (err) {
    toastError(err, 'Could not load goals.');
  }
}

async function createGoal(body) {
  const created = await api('/api/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await loadGoals();
  toastSuccess('Goal saved.');
  return created;
}

async function toggleGoal(id) {
  await api('/api/goals/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH' });
  await loadGoals();
}

async function deleteGoal(id) {
  await api('/api/goals/' + encodeURIComponent(id), { method: 'DELETE' });
  await loadGoals();
}

async function addGoalAction(id, body) {
  await api('/api/goals/' + encodeURIComponent(id) + '/actions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await loadGoals();
  toastSuccess('Action logged.');
}

async function updateGoalAction(goalId, actionId, body) {
  await api(
    '/api/goals/' + encodeURIComponent(goalId) + '/actions/' + encodeURIComponent(actionId),
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );
  await loadGoals();
  toastSuccess('Action updated.');
}

async function deleteGoalAction(goalId, actionId) {
  await api(
    '/api/goals/' + encodeURIComponent(goalId) + '/actions/' + encodeURIComponent(actionId),
    { method: 'DELETE' }
  );
  await loadGoals();
  toastSuccess('Action deleted.');
}

async function deleteHabit(id) {
  await api('/api/habits/' + encodeURIComponent(id), { method: 'DELETE' });
  state.habits = state.habits.filter((h) => h.id !== id);
  await refreshScore();
}

async function quickAddWater(amountMl) {
  try {
    const updated = await api('/api/water/entries', {
      method: 'POST',
      body: JSON.stringify({ amountMl: amountMl }),
    });
    state.water = updated;
    render();
  } catch (err) {
    toastError(err, 'Could not log water right now.');
  }
}

async function updateWaterGoal(goalMl) {
  try {
    const updated = await api('/api/water/goal', {
      method: 'PUT',
      body: JSON.stringify({ goalMl: goalMl }),
    });
    state.water = updated;
    render();
  } catch (err) {
    toastError(err, 'Could not update water goal right now.');
  }
}

async function logFoodEntry(payload) {
  try {
    const updated = await api('/api/food/entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.food = updated;
    cacheFoodSummary(updated);
    render();
    toastSuccess('Food logged.');
  } catch (err) {
    toastError(err, 'Could not log food right now.');
  }
}

function todayKeyNow() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

async function saveSleepEntry(payload) {
  const key = payload.date || todayKeyNow();
  // Optimistic local update + cache mirror, then persist to the backend.
  state.wellness = Object.assign(emptyWellness(), state.wellness || {});
  state.wellness.sleepByDate = Object.assign({}, state.wellness.sleepByDate || {}, {
    [key]: {
      date: key,
      bedtime: payload.bedtime || '',
      wakeTime: payload.wakeTime || '',
      quality: payload.quality || 'okay',
      note: payload.note || '',
      updatedAt: new Date().toISOString(),
    },
  });
  persistWellness();
  render();
  try {
    await api('/api/daily-logs/sleep', {
      method: 'POST',
      body: JSON.stringify({
        date: key,
        bedtime: payload.bedtime || null,
        wakeTime: payload.wakeTime || null,
        quality: payload.quality || 'okay',
        note: payload.note || null,
      }),
    });
    toastSuccess('Sleep saved.');
  } catch (err) {
    toastError(err, 'Saved locally, but could not sync sleep.');
  }
}

async function saveMoodEntry(payload) {
  const key = payload.date || todayKeyNow();
  state.wellness = Object.assign(emptyWellness(), state.wellness || {});
  state.wellness.moodByDate = Object.assign({}, state.wellness.moodByDate || {}, {
    [key]: {
      date: key,
      mood: payload.mood || 'okay',
      energy: payload.energy || 'medium',
      stress: payload.stress || 'normal',
      note: payload.note || '',
      updatedAt: new Date().toISOString(),
    },
  });
  persistWellness();
  render();
  try {
    await api('/api/daily-logs/mood', {
      method: 'POST',
      body: JSON.stringify({
        date: key,
        mood: payload.mood || 'okay',
        energy: payload.energy || 'medium',
        stress: payload.stress || 'normal',
        note: payload.note || null,
      }),
    });
    toastSuccess('Check-in saved.');
  } catch (err) {
    toastError(err, 'Saved locally, but could not sync mood.');
  }
}

function rememberPhotoFood(foodName, estimate, usedPhoto) {
  if (!usedPhoto) return;
  const history = Array.isArray(state.wellness && state.wellness.photoHistory)
    ? state.wellness.photoHistory
    : [];
  const confidence =
    estimate && Number.isFinite(Number(estimate.confidence))
      ? Math.round(Number(estimate.confidence) * 100)
      : null;
  const mealType = (estimate && (estimate.mealType || estimate.suggestedMealType)) || 'meal';
  const fallbackNeeded = !!(estimate && estimate.fallbackNeeded);
  state.wellness = Object.assign(emptyWellness(), state.wellness || {}, {
    photoHistory: [
      {
        id: String(Date.now()),
        date: todayKeyNow(),
        foodName,
        mealType,
        confidence,
        fallbackNeeded,
        createdAt: new Date().toISOString(),
      },
      ...history,
    ].slice(0, 12),
  });
  persistWellness();
  // Persist to the backend (optimistic; cache already updated).
  api('/api/food/photo-history', {
    method: 'POST',
    body: JSON.stringify({ foodName, mealType, confidence, fallbackNeeded, date: todayKeyNow() }),
  }).catch((err) => {
    console.error('❌ CRITICAL: rememberPhotoFood failed to reach database:', err);
  });
}

function openSleepSchedule() {
  const today = todayKeyNow();
  const existing = (state.wellness.sleepByDate || {})[today] || {};
  const dateInput = h('input', { type: 'date', class: 'gb-input', value: existing.date || today });
  const bedInput = h('input', {
    type: 'time',
    class: 'gb-input',
    value: existing.bedtime || '23:00',
  });
  const wakeInput = h('input', {
    type: 'time',
    class: 'gb-input',
    value: existing.wakeTime || '07:00',
  });
  const quality = segmented(
    [
      { value: 'low', label: 'Low' },
      { value: 'okay', label: 'Okay' },
      { value: 'good', label: 'Good' },
      { value: 'great', label: 'Great' },
    ],
    existing.quality || 'okay'
  );
  const noteInput = h(
    'textarea',
    { class: 'gb-input gb-input--about', maxlength: '280', placeholder: 'Optional note' },
    existing.note || ''
  );
  openModal({
    title: 'Sleep schedule',
    sub: 'Save bedtime, wake time, and quality for today.',
    body: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Date'),
      dateInput,
      h('div', { class: 'gb-field-label' }, 'Bedtime'),
      bedInput,
      h('div', { class: 'gb-field-label' }, 'Wake time'),
      wakeInput,
      h('div', { class: 'gb-field-label' }, 'Quality'),
      quality.node,
      h('div', { class: 'gb-field-label' }, 'Note'),
      noteInput
    ),
    primary: 'Save sleep',
    onPrimary: async () =>
      saveSleepEntry({
        date: dateInput.value || today,
        bedtime: bedInput.value,
        wakeTime: wakeInput.value,
        quality: quality.get(),
        note: noteInput.value.trim(),
      }),
  });
}

function openMoodCheckin() {
  const today = todayKeyNow();
  const existing = (state.wellness.moodByDate || {})[today] || {};
  const mood = segmented(
    [
      { value: 'low', label: 'Low' },
      { value: 'okay', label: 'Okay' },
      { value: 'good', label: 'Good' },
      { value: 'great', label: 'Great' },
    ],
    existing.mood || 'okay'
  );
  const energy = segmented(
    [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    existing.energy || 'medium'
  );
  const stress = segmented(
    [
      { value: 'calm', label: 'Calm' },
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
    ],
    existing.stress || 'normal'
  );
  const noteInput = h(
    'textarea',
    { class: 'gb-input gb-input--about', maxlength: '280', placeholder: 'Optional note' },
    existing.note || ''
  );
  openModal({
    title: 'Mood check-in',
    sub: 'A quick signal for your weekly patterns.',
    body: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Mood'),
      mood.node,
      h('div', { class: 'gb-field-label' }, 'Energy'),
      energy.node,
      h('div', { class: 'gb-field-label' }, 'Stress'),
      stress.node,
      h('div', { class: 'gb-field-label' }, 'Note'),
      noteInput
    ),
    primary: 'Save check-in',
    onPrimary: async () =>
      saveMoodEntry({
        date: today,
        mood: mood.get(),
        energy: energy.get(),
        stress: stress.get(),
        note: noteInput.value.trim(),
      }),
  });
}

function openDailyPlan() {
  const today = todayKeyNow();
  const pendingTasks = state.tasks.filter((t) => !t.done).slice(0, 4);
  const pendingHabits = state.habits.filter((habit) => !habit.doneToday).slice(0, 4);
  const waterGoal = state.water && state.water.goalMl ? state.water.goalMl : 2000;
  const waterDone = state.water && state.water.consumedMl ? state.water.consumedMl : 0;
  const sleep = (state.wellness.sleepByDate || {})[today];
  const mood = (state.wellness.moodByDate || {})[today];
  const rows = [
    {
      icon: 'sunrise',
      title: 'Start steady',
      text: pendingHabits.length
        ? 'Do ' + pendingHabits[0].name + ' first.'
        : 'Pick one small habit and finish it early.',
    },
    {
      icon: 'list-checks',
      title: 'Focus block',
      text: pendingTasks.length
        ? 'Work on ' + pendingTasks[0].title + '.'
        : 'Add one meaningful task for today.',
    },
    {
      icon: 'droplets',
      title: 'Hydration',
      text:
        waterDone >= waterGoal
          ? 'Water goal is already covered.'
          : 'Drink ' + Math.max(250, waterGoal - waterDone) + ' ml through the day.',
    },
    {
      icon: 'moon',
      title: 'Evening close',
      text: sleep ? 'Protect your saved sleep routine.' : 'Add sleep schedule before the day ends.',
    },
    {
      icon: 'heart',
      title: 'Reflection',
      text: mood ? 'Use your mood note to plan gently.' : 'Do a 20-second mood check-in.',
    },
  ];
  openModal({
    title: 'Today plan',
    sub: 'A simple plan from your current tasks, habits, water, sleep, and mood.',
    body: h(
      'div',
      { class: 'gb-plan-list' },
      rows.map((row) =>
        h(
          'div',
          { class: 'gb-plan-row' },
          h('span', { class: 'gb-plan-icon' }, Icon(row.icon, { size: 17, sw: 2.4 })),
          h(
            'span',
            { class: 'gb-plan-copy' },
            h('strong', null, row.title),
            h('span', null, row.text)
          )
        )
      )
    ),
    primary: 'Looks good',
    onPrimary: async () => {},
  });
}

async function addSuggestedReminder(text, time, tag) {
  await addReminder(todayKeyNow(), text, time || '19:00', tag || 'personal', 'none', null);
}

function openAddFood() {
  let photoDataUrl = '';
  let photoItems = [];
  let photoConfidence = 0;
  let photoFallbackNeeded = false;
  const mealTypeSeg = segmented(
    [
      { value: 'home', label: 'Home' },
      { value: 'hotel', label: 'Hotel' },
    ],
    'home'
  );

  const foodNameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Paneer butter masala',
    maxlength: 255,
  });
  const quantityInput = h('input', {
    type: 'number',
    class: 'gb-input',
    placeholder: 'e.g. 180 (optional)',
    min: '10',
    max: '2000',
    step: '1',
  });
  // Calories, typed. Everything else on this form feeds an estimator; this one
  // overrides it. Someone holding the packet knows the number better than any
  // guess we can make from a food name, and a manual entry costs no lookup and
  // no AI call.
  const kcalInput = h('input', {
    type: 'number',
    class: 'gb-input',
    placeholder: 'e.g. 320 — leave blank to estimate',
    min: '1',
    max: '5000',
    step: '1',
    'aria-label': 'Calories (optional)',
  });
  const platePhotoInput = h('input', {
    type: 'file',
    class: 'gb-input',
    accept: 'image/*',
    capture: 'environment',
  });

  const itemsContainer = h('div', {
    class: 'gb-food-items-container',
    style: { marginTop: '16px', display: 'none' },
  });

  const photoHint = h(
    'div',
    { style: { fontSize: '0.75rem', color: 'var(--fg3)' } },
    'Optional: upload a plate photo to detect multiple items automatically.'
  );

  async function readImageDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.readAsDataURL(file);
    });
  }

  function createItemRow(item, index) {
    const nameInput = h('input', {
      type: 'text',
      class: 'gb-input gb-input--inline',
      value: item.foodName || '',
      placeholder: 'Food name',
      maxlength: 100,
      style: { flex: '1', marginRight: '8px' },
    });

    const quantityInput = h('input', {
      type: 'number',
      class: 'gb-input gb-input--inline',
      value: item.quantityGrams || '',
      placeholder: 'g',
      min: '10',
      max: '2000',
      style: { width: '70px', marginRight: '8px' },
    });

    const calorieDisplay = h(
      'div',
      {
        style: {
          width: '80px',
          paddingRight: '8px',
          fontSize: '0.8125rem',
          fontWeight: '500',
          alignSelf: 'center',
        },
      },
      item.kcalEstimated ? item.kcalEstimated + ' kcal' : '—'
    );

    const deleteBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--icon',
        title: 'Remove item',
        onclick: () => {
          photoItems.splice(index, 1);
          renderItemsList();
        },
        style: { padding: '4px 8px', minHeight: '36px' },
      },
      '✕'
    );

    const updateItem = () => {
      const newQty = parseInt(quantityInput.value);
      if (Number.isFinite(newQty) && newQty > 0) {
        photoItems[index] = {
          foodName: nameInput.value.trim() || item.foodName,
          quantityGrams: newQty,
          kcalPer100g: item.kcalPer100g,
          kcalEstimated: Math.round((item.kcalPer100g * newQty) / 100),
        };
        calorieDisplay.textContent = Math.round((item.kcalPer100g * newQty) / 100) + ' kcal';
      }
    };

    nameInput.addEventListener('change', updateItem);
    quantityInput.addEventListener('change', updateItem);

    const row = h(
      'div',
      {
        class: 'gb-food-item-row',
        style: { display: 'flex', gap: '4px', marginBottom: '12px', alignItems: 'center' },
      },
      nameInput,
      quantityInput,
      calorieDisplay,
      deleteBtn
    );

    return row;
  }

  function renderItemsList() {
    itemsContainer.replaceChildren();
    if (photoItems.length === 0) {
      itemsContainer.style.display = 'none';
      return;
    }

    itemsContainer.style.display = 'block';
    const header = h(
      'div',
      {
        style: {
          fontSize: '0.75rem',
          fontWeight: '600',
          marginBottom: '12px',
          color: 'var(--fg2)',
          textTransform: 'uppercase',
        },
      },
      'Detected items (editable)'
    );
    itemsContainer.appendChild(header);

    photoItems.forEach((item, idx) => {
      itemsContainer.appendChild(createItemRow(item, idx));
    });
  }

  async function estimateFromPhoto() {
    const file = platePhotoInput.files && platePhotoInput.files[0];
    if (!file) {
      throw new Error('Please choose a photo first.');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Photo is too large. Use an image under 5 MB.');
    }
    const dataUrl = await readImageDataUrl(file);
    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
      throw new Error('Invalid image file.');
    }
    photoDataUrl = dataUrl;

    const result = await api('/api/food/photo-estimate-multi', {
      method: 'POST',
      body: JSON.stringify({
        imageDataUrl: photoDataUrl,
        mealType: mealTypeSeg.get(),
        portionSize: 'medium',
        riceBase: 'unsure',
      }),
    });

    photoItems =
      result && result.items
        ? result.items.map((item) => ({
            foodName: item.foodName,
            quantityGrams: item.quantityGrams,
            kcalPer100g: item.kcalPer100g,
            kcalEstimated: Math.round((item.kcalPer100g * item.quantityGrams) / 100),
          }))
        : [];
    photoConfidence = result && result.confidence ? result.confidence : 0;
    photoFallbackNeeded = result && result.fallbackNeeded;

    renderItemsList();

    if (result && result.source === 'fallback') {
      toastError(
        { message: 'Photo analysis unavailable right now. Please enter food manually.' },
        'Photo analysis unavailable right now. Please enter food manually.'
      );
    } else if (photoItems.length > 0) {
      toastSuccess(result.message || 'Photo analyzed. Items detected!');
    } else if (result && result.message) {
      toastError(
        { message: result.message },
        'Could not analyze photo. Please enter food manually.'
      );
    } else {
      toastError(
        { message: 'Could not analyze photo. Please enter food manually.' },
        'Could not analyze photo. Please enter food manually.'
      );
    }

    return result;
  }

  const body = h(
    'div',
    { class: 'gb-form' },
    h('div', { class: 'gb-field-label' }, 'Meal type'),
    mealTypeSeg.node,
    h('div', { class: 'gb-field-label' }, 'Food name (or photo)'),
    foodNameInput,
    h('div', { class: 'gb-field-label' }, 'Quantity (grams, optional)'),
    quantityInput,
    h('div', { class: 'gb-field-label' }, 'Calories (optional)'),
    kcalInput,
    h(
      'div',
      { class: 'gb-field-hint' },
      'Know the number? Type it and we\u2019ll use it exactly. Leave it blank and we\u2019ll estimate.'
    ),
    h('div', { class: 'gb-field-label' }, 'Plate photo (optional)'),
    platePhotoInput,
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--secondary gb-btn--compact',
        onclick: async () => {
          try {
            await estimateFromPhoto();
          } catch {
            const safeMsg = 'Could not analyze photo. Please enter manually.';
            toastError({ message: safeMsg }, safeMsg);
          }
        },
      },
      'Analyze photo'
    ),
    photoHint,
    itemsContainer,
    h(
      'div',
      { style: { fontSize: '0.75rem', color: 'var(--fg3)', marginTop: '8px' } },
      'No grams needed \u2014 we estimate from the food name and an optional photo. Typed calories always win.'
    )
  );

  openModal({
    title: 'Log food',
    body,
    primary: 'Add food',
    onPrimary: async () => {
      let entriesToAdd = [];
      const mealType = mealTypeSeg.get();

      // If we have photo items, use them
      if (photoItems.length > 0) {
        const loggedAtNow = new Date().toISOString();
        entriesToAdd = photoItems.map((item) => ({
          foodName: item.foodName,
          quantityGrams: item.quantityGrams,
          mealType: mealType,
          loggedAt: loggedAtNow,
          note: photoDataUrl ? 'photo:' + (photoConfidence >= 0.7 ? 'used' : 'fallback') : null,
        }));
      } else {
        // Otherwise use manual input
        const foodName = foodNameInput.value.trim();
        const quantityRaw = quantityInput.value ? Number(quantityInput.value) : null;
        if (!foodName) {
          foodNameInput.focus();
          throw new Error('Food name or photo is required');
        }
        if (
          quantityRaw != null &&
          (!Number.isFinite(quantityRaw) || quantityRaw < 10 || quantityRaw > 2000)
        ) {
          quantityInput.focus();
          throw new Error('Quantity must be between 10 and 2000 grams.');
        }
        const kcalRaw = kcalInput.value ? Number(kcalInput.value) : null;
        // The ceiling is one meal, not one day — a typed 50,000 is a slipped
        // finger. Say so here rather than letting the server answer 400.
        if (kcalRaw != null && (!Number.isFinite(kcalRaw) || kcalRaw < 1 || kcalRaw > 5000)) {
          kcalInput.focus();
          throw new Error('Calories must be between 1 and 5,000 for a single entry.');
        }
        entriesToAdd = [
          {
            foodName: foodName,
            quantityGrams: quantityRaw != null ? Math.round(quantityRaw) : null,
            mealType: mealType,
            kcal: kcalRaw != null ? Math.round(kcalRaw) : null,
            loggedAt: new Date().toISOString(),
            note: null,
          },
        ];
      }

      // Add all entries
      for (const entry of entriesToAdd) {
        await logFoodEntry(entry);
      }

      rememberPhotoFood(
        photoItems.map((i) => i.foodName).join(', ') || foodNameInput.value.trim(),
        { confidence: photoConfidence, fallbackNeeded: photoFallbackNeeded },
        !!photoDataUrl
      );
    },
  });

  setTimeout(() => foodNameInput.focus(), 60);
}

async function deleteWaterEntry(entryId) {
  try {
    const updated = await api('/api/water/entries/' + entryId, {
      method: 'DELETE',
    });
    state.water = updated;
    render();
  } catch (err) {
    toastError(err, 'Could not delete water entry.');
  }
}

async function deleteFoodEntry(entryId) {
  try {
    const updated = await api('/api/food/entries/' + entryId, {
      method: 'DELETE',
    });
    state.food = updated;
    cacheFoodSummary(updated);
    render();
    toastSuccess('Food entry deleted.');
  } catch (err) {
    toastError(err, 'Could not delete food entry.');
  }
}

/* ---- Notification handlers ---- */
function unreadNotifs() {
  return state.notifications.filter((n) => !n.readAt).length;
}

async function refreshNotifications() {
  try {
    state.notifications = await api('/api/notifications');
    repaintOverlays();
  } catch (_) {
    /* silent */
  }
}

async function markNotificationRead(id) {
  try {
    await api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH' });
    state.notifications = state.notifications.map((n) =>
      n.id === id ? { ...n, readAt: new Date().toISOString() } : n
    );
    repaintOverlays();
  } catch (err) {
    console.warn(err);
  }
}

async function respondMentorshipRequest(requestId, notifId, accept) {
  try {
    await api(
      '/api/mentorship/requests/' +
        encodeURIComponent(requestId) +
        (accept ? '/accept' : '/reject'),
      { method: 'POST' }
    );
    // Backend deletes the request-bell entry on accept/reject. Drop it
    // optimistically here so the UI doesn't flash a stale row.
    state.notifications = state.notifications.filter((n) => n.id !== notifId);
    render();
    // Re-fetch in case the server-side delete also created new rows.
    await refreshNotifications();
  } catch (err) {
    toastError(err, 'Could not respond to invite.');
  }
}

function toggleNotifOpen() {
  state.notifOpen = !state.notifOpen;
  state.profileOpen = false;
  state.moreOpen = false;
  repaintOverlays();
}

function toggleProfileOpen() {
  state.profileOpen = !state.profileOpen;
  state.notifOpen = false;
  state.moreOpen = false;
  repaintOverlays();
}

function toggleMoreOpen() {
  state.moreOpen = !state.moreOpen;
  state.notifOpen = false;
  state.profileOpen = false;
  repaintOverlays();
}

function profileDropdown() {
  if (!state.profileOpen) return null;
  const u = state.user || {};
  const initials = (u.displayName || u.email || 'B')[0].toUpperCase();
  const xpToNextLevel = 500;
  const xpProgress = Math.min(
    100,
    Math.round((((u.xpTotal || 0) % xpToNextLevel) / xpToNextLevel) * 100)
  );
  return h(
    'div',
    { class: 'gb-profile-pop' },
    h(
      'div',
      { class: 'gb-profile-pop-head' },
      h('div', { class: 'gb-profile-pop-avatar' }, initials),
      h(
        'div',
        { class: 'gb-profile-pop-info' },
        h('div', { class: 'gb-profile-pop-name' }, u.displayName || 'Buddy'),
        h('div', { class: 'gb-profile-pop-email' }, u.email || ''),
        h(
          'div',
          { class: 'gb-profile-pop-meta' },
          'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP'
        )
      )
    ),
    h(
      'div',
      { class: 'gb-profile-pop-xp' },
      h(
        'div',
        { class: 'gb-profile-pop-xp-bar' },
        h('div', { class: 'gb-profile-pop-xp-fill', style: { width: xpProgress + '%' } })
      ),
      h(
        'div',
        { class: 'gb-profile-pop-xp-label' },
        xpProgress + '% to Level ' + ((u.level || 1) + 1)
      )
    ),
    h('div', { class: 'gb-profile-pop-divider' }),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-profile-pop-item',
        onclick: () => {
          state.profileOpen = false;
          setScreen('achievements');
        },
      },
      Icon('award', { size: 16 }),
      'Achievements'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-profile-pop-item',
        onclick: () => {
          state.profileOpen = false;
          repaintOverlays();
          openWeeklyReview();
        },
      },
      Icon('calendar-check', { size: 16 }),
      'Weekly review'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-profile-pop-item',
        onclick: () => {
          state.profileOpen = false;
          repaintOverlays();
          openProfileSettings();
        },
      },
      Icon('settings', { size: 16 }),
      'Settings'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-profile-pop-item is-danger',
        onclick: () => {
          state.profileOpen = false;
          logout();
        },
      },
      Icon('log-out', { size: 16 }),
      'Log out'
    )
  );
}

/** Parse the current location hash → screen id. Defaults to home.
    Reads `SCREENS` directly rather than a hand-kept id list. There used to be a
    parallel `SCREEN_IDS` array, and it was missing 'report' — so refreshing on
    Progress, or opening any link to it, silently bounced you to Home. A second
    list of the same thing will drift; this one can't. Safe despite `SCREENS`
    being declared further down: nothing calls this until after boot. */
function screenFromHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCREENS, raw) ? raw : 'home';
}

function setScreen(id, opts) {
  opts = opts || {};
  // Tapping a "More" item that's already active should still close the sheet.
  if (state.screen === id && !opts.force) {
    if (state.moreOpen) {
      state.moreOpen = false;
      repaintOverlays();
    }
    return;
  }
  state.screen = id;
  state.notifOpen = false;
  state.profileOpen = false;
  state.moreOpen = false;
  if (!opts.fromHash) {
    const target = '#/' + id;
    if (window.location.hash !== target) {
      // pushState avoids piling history entries when the user double-taps.
      history.pushState(null, '', target);
    }
  }
  render();
}

/** Sync screen with the URL on back/forward navigation. */
window.addEventListener('hashchange', () => {
  if (!state.user) return;
  setScreen(screenFromHash(), { fromHash: true });
});

/**
 * Switch the theme. The only writer of data-theme: inside the app the status bar
 * is painted by Android and has to be repainted alongside it, and three separate
 * call sites setting the attribute by hand is three chances to forget.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  applyNativeStatusBar(theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  try {
    CacheStorage.setItem(THEME_KEY, state.theme);
  } catch (_) {}
  saveUiPrefs({ theme: state.theme });
  render();
}

function togglePremium() {
  const apply = () => {
    state.premium = !state.premium;
    applyPremium(state.premium);
    try {
      CacheStorage.setItem(PREMIUM_KEY, state.premium ? '1' : '0');
    } catch (_) {}
    saveUiPrefs({ premium: state.premium });
    toastSuccess(state.premium ? 'Premium look on.' : 'Back to the classic look.');
    render();
  };
  // Every surface changes at once, so cut-to-black reads as a glitch. A view
  // transition cross-fades the old frame into the new one; browsers without it
  // just get the instant swap. ponytail: no library, no manual snapshotting.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) document.startViewTransition(apply);
  else apply();
}

async function saveProfileDetails(payload) {
  const updated = await api('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  syncUserSession(updated);
  toastSuccess('Changes saved.');
  render();
  return updated;
}

// Country dial codes for the phone-number picker. India first (default).
const COUNTRY_CODES = [
  { d: '91', flag: '🇮🇳', name: 'India' },
  { d: '1', flag: '🇺🇸', name: 'United States' },
  { d: '1', flag: '🇨🇦', name: 'Canada' },
  { d: '44', flag: '🇬🇧', name: 'United Kingdom' },
  { d: '971', flag: '🇦🇪', name: 'UAE' },
  { d: '65', flag: '🇸🇬', name: 'Singapore' },
  { d: '61', flag: '🇦🇺', name: 'Australia' },
  { d: '60', flag: '🇲🇾', name: 'Malaysia' },
  { d: '49', flag: '🇩🇪', name: 'Germany' },
  { d: '33', flag: '🇫🇷', name: 'France' },
  { d: '81', flag: '🇯🇵', name: 'Japan' },
  { d: '86', flag: '🇨🇳', name: 'China' },
  { d: '966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { d: '880', flag: '🇧🇩', name: 'Bangladesh' },
  { d: '94', flag: '🇱🇰', name: 'Sri Lanka' },
];

/** Split an E.164 string into (dial, local) by longest-prefix match. */
function splitDial(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits) {
    const byLen = COUNTRY_CODES.slice().sort((a, b) => b.d.length - a.d.length);
    const hit = byLen.find((co) => digits.startsWith(co.d) && digits.length > co.d.length);
    if (hit) {
      return { dial: hit.d, local: digits.slice(hit.d.length) };
    }
  }
  return { dial: '91', local: digits };
}

/**
 * Country code and last four digits; the middle masked. Enough to recognise
 * your own number, not enough for someone reading over your shoulder — the
 * settings panel is open on a screen far more often than it is edited.
 */
function maskPhone(number) {
  const { dial, local } = splitDial(number);
  if (local.length <= 4) {
    return '+' + dial + ' ' + local;
  }
  return '+' + dial + ' ' + '\u2022'.repeat(local.length - 4) + local.slice(-4);
}

/**
 * A country-code dropdown + local-number field. Users pick their country
 * so they can't forget the dial code (which previously produced broken
 * numbers like +6374044117). `getValue()` returns a full E.164 string.
 */
function CountryPhoneInput(prefill) {
  const { dial: dial0, local: local0 } = splitDial(prefill);
  let dial = dial0,
    local = local0;

  const sel = h('select', { class: 'gb-input gb-phone-cc', 'aria-label': 'Country code' });
  COUNTRY_CODES.forEach((co) => {
    const o = h('option', { value: co.d }, co.flag + ' ' + co.name + ' (+' + co.d + ')');
    // Select the first option matching the parsed dial code.
    if (co.d === dial && !sel.querySelector('option[selected]')) o.selected = true;
    sel.appendChild(o);
  });

  const numIn = h('input', {
    type: 'tel',
    class: 'gb-input gb-phone-num',
    inputmode: 'numeric',
    placeholder: '98765 43210',
    maxlength: '15',
    value: local,
  });

  const el = h('div', { class: 'gb-phone-input' }, sel, numIn);
  return {
    el,
    focus: () => numIn.focus(),
    getValue: () => {
      const localDigits = (numIn.value || '').replace(/\D/g, '').replace(/^0+/, '');
      return localDigits ? '+' + sel.value + localDigits : '';
    },
  };
}

/* Segmented "slider": a track of segments with a brand thumb that glides to
   the active one, showing its pane. `slides` = [{ id, label, pane }]. Returns
   the bar element; panes are toggled by display. */
function buildSegSlider(slides, initialId) {
  const btnMap = {};
  const thumb = h('div', { class: 'gb-segnav-thumb' });
  thumb.style.width = 'calc((100% - 8px) / ' + slides.length + ')';
  const move = (id) => {
    thumb.style.transform = 'translateX(' + slides.findIndex((t) => t.id === id) * 100 + '%)';
  };
  const bar = h('div', { class: 'gb-segnav', role: 'tablist' }, thumb);
  slides.forEach(({ id, label }) => {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': id === initialId ? 'true' : 'false',
        class: 'gb-segnav-btn' + (id === initialId ? ' is-active' : ''),
        onclick: () => {
          slides.forEach((t) => {
            if (t.pane) t.pane.style.display = 'none';
            btnMap[t.id].classList.remove('is-active');
            btnMap[t.id].setAttribute('aria-selected', 'false');
          });
          const cur = slides.find((t) => t.id === id);
          if (cur.pane) cur.pane.style.display = '';
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
          move(id);
        },
      },
      label
    );
    btnMap[id] = btn;
    bar.appendChild(btn);
  });
  slides.forEach((t) => {
    if (t.pane) t.pane.style.display = t.id === initialId ? '' : 'none';
  });
  move(initialId);
  return bar;
}

/* ---- Settings panes that shape the app itself ----
   These used to be their own "Customise" modal, so the app had two settings
   doors and no way to guess which held what (dark mode behind one, notification
   prefs behind the other). Now they're just panes; `openProfileSettings` mounts
   them as the Display and Layout tabs of the single Settings modal. */
function customisePanes() {
  const u = state.user || {};

  // Features tab — on/off toggles, persisted instantly.
  const featuresPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '8px' } },
      'Turn parts of Growth Buddy on or off. Changes apply instantly.'
    ),
    ...FEATURE_DEFS.map((def) => {
      const isOn = () => featureOn(def.key);
      const sw = h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': isOn() ? 'true' : 'false',
          'aria-label': def.label,
          class: 'gb-switch' + (isOn() ? ' is-on' : ''),
        },
        h('span', { class: 'gb-switch-knob' })
      );
      sw.onclick = async () => {
        const next = !isOn();
        sw.classList.toggle('is-on', next);
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        try {
          await setFeature(def.key, next);
        } catch (err) {
          sw.classList.toggle('is-on', !next);
          sw.setAttribute('aria-checked', !next ? 'true' : 'false');
          toastError(err, 'Could not update features.');
        }
      };
      return h(
        'div',
        { class: 'gb-feature-row' },
        h(
          'div',
          { class: 'gb-feature-row-text' },
          h('div', { class: 'gb-feature-row-label' }, def.label),
          h('div', { class: 'gb-feature-row-desc' }, def.desc)
        ),
        sw
      );
    })
  );

  // Home tab — show/hide + reorder home-screen widgets. Saves automatically.
  let homeWorking = resolveHomeLayout(u.homeLayout || null);
  const homeListEl = h('div', { class: 'gb-home-cust-list' });
  const persistHome = () =>
    saveHomeLayout(homeWorking.map((x) => ({ id: x.id, enabled: x.enabled })));
  const renderHomeList = () => {
    homeListEl.replaceChildren();
    homeWorking.forEach((item, idx) => {
      const def = HOME_WIDGETS.find((w) => w.id === item.id) || { label: item.id, desc: '' };
      const featureOff = def.feature && !featureOn(def.feature);
      const sw = h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': item.enabled ? 'true' : 'false',
          'aria-label': def.label,
          class: 'gb-switch' + (item.enabled ? ' is-on' : ''),
        },
        h('span', { class: 'gb-switch-knob' })
      );
      sw.onclick = () => {
        item.enabled = !item.enabled;
        renderHomeList();
        persistHome();
      };
      const move = (delta, label, icon, disabled) => {
        const btn = h(
          'button',
          { type: 'button', class: 'gb-home-cust-move', 'aria-label': label, disabled },
          Icon(icon, { size: 16, sw: 2.4 })
        );
        if (!disabled) {
          btn.onclick = () => {
            const j = idx + delta;
            const tmp = homeWorking[j];
            homeWorking[j] = homeWorking[idx];
            homeWorking[idx] = tmp;
            renderHomeList();
            persistHome();
          };
        }
        return btn;
      };
      homeListEl.appendChild(
        h(
          'div',
          { class: 'gb-home-cust-row' + (item.enabled ? '' : ' is-off') },
          h(
            'div',
            { class: 'gb-home-cust-moves' },
            move(-1, 'Move up', 'chevron-up', idx === 0),
            move(1, 'Move down', 'chevron-down', idx === homeWorking.length - 1)
          ),
          h(
            'div',
            { class: 'gb-home-cust-text' },
            h('div', { class: 'gb-home-cust-label' }, def.label),
            h(
              'div',
              { class: 'gb-home-cust-desc' },
              featureOff ? 'Turn on the ' + def.feature + ' feature to show this' : def.desc
            )
          ),
          sw
        )
      );
    });
    refreshIcons();
  };
  renderHomeList();
  const homePane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '10px' } },
      'Pick your Home cards and reorder with the arrows. Saves as you go.'
    ),
    homeListEl
  );

  // Navigation tab — choose which destinations sit in the bottom bar vs
  // "More", and reorder them. Saves automatically. Mirrors the Home pane.
  const NAV_BAR_MAX = 5;
  let navWorking = resolveNavLayout((u && u.navLayout) || null);
  const navListEl = h('div', { class: 'gb-home-cust-list' });
  const persistNav = () => saveNavLayout(navWorking.map((x) => ({ id: x.id, primary: x.primary })));
  const renderNavList = () => {
    navListEl.replaceChildren();
    const barCount = navWorking.filter((x) => x.primary).length;
    navWorking.forEach((item, idx) => {
      const def = NAV_CATALOG.find((w) => w.id === item.id) || { label: item.id };
      const featureOff = def.feature && !featureOn(def.feature);
      const sw = h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': item.primary ? 'true' : 'false',
          'aria-label': 'Show ' + def.label + ' in the bar',
          class: 'gb-switch' + (item.primary ? ' is-on' : ''),
        },
        h('span', { class: 'gb-switch-knob' })
      );
      sw.onclick = () => {
        if (!item.primary && barCount >= NAV_BAR_MAX) {
          toastError(
            { message: 'The bar holds up to ' + NAV_BAR_MAX + '. Move one to More first.' },
            'Bar is full'
          );
          return;
        }
        item.primary = !item.primary;
        renderNavList();
        persistNav();
      };
      const move = (delta, label, icon, disabled) => {
        const btn = h(
          'button',
          { type: 'button', class: 'gb-home-cust-move', 'aria-label': label, disabled },
          Icon(icon, { size: 16, sw: 2.4 })
        );
        if (!disabled) {
          btn.onclick = () => {
            const j = idx + delta;
            const tmp = navWorking[j];
            navWorking[j] = navWorking[idx];
            navWorking[idx] = tmp;
            renderNavList();
            persistNav();
          };
        }
        return btn;
      };
      navListEl.appendChild(
        h(
          'div',
          { class: 'gb-home-cust-row' + (item.primary ? '' : ' is-off') },
          h(
            'div',
            { class: 'gb-home-cust-moves' },
            move(-1, 'Move up', 'chevron-up', idx === 0),
            move(1, 'Move down', 'chevron-down', idx === navWorking.length - 1)
          ),
          h(
            'div',
            { class: 'gb-home-cust-text' },
            h('div', { class: 'gb-home-cust-label' }, def.label),
            h(
              'div',
              { class: 'gb-home-cust-desc' },
              featureOff
                ? 'Turn on the ' + def.feature + ' feature to show this'
                : item.primary
                  ? 'In the bottom bar'
                  : 'In the More menu'
            )
          ),
          sw
        )
      );
    });
    refreshIcons();
  };
  renderNavList();
  const navPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '10px' } },
      'Pick up to ' +
        NAV_BAR_MAX +
        ' tabs for the bottom bar; the rest go under “More”. Saves as you go.'
    ),
    navListEl
  );

  // Money tab — tags, currency and prompts. Only when the feature is on.
  const moneyPane = featureOn('money')
    ? h('div', { class: 'gb-settings-pane' }, MoneyCustomisePane(state.money, saveMoney))
    : null;

  // Display tab — text size and theme. Text size scales every rem in the app.
  const displayPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h('div', { class: 'gb-settings-sec-label' }, 'Text size'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '8px' } },
      'Makes everything bigger — words, buttons and rows. Pick whatever is easiest to read.'
    ),
    segmented(
      [
        { value: 'normal', label: 'Normal' },
        { value: 'large', label: 'Large' },
        { value: 'larger', label: 'Largest' },
      ],
      state.textScale,
      (v) => setTextScale(v)
    ).node,
    h(
      'div',
      { class: 'gb-textsize-sample' },
      h('div', { class: 'gb-textsize-sample-title' }, 'Sample'),
      h('div', { class: 'gb-textsize-sample-body' }, 'Drink a glass of water · 8:00 in the morning')
    ),
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '18px' } }, 'Theme'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '8px' } },
      'Light is easier to read in daylight. Dark is easier at night.'
    ),
    segmented(
      [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      state.theme,
      (v) => {
        if (v !== state.theme) toggleTheme();
      }
    ).node,
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '18px' } }, 'Look'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '8px' } },
      'Premium adds softer shadows, frosted glass and a bit more life to every tap.'
    ),
    segmented(
      [
        { value: 'classic', label: 'Classic' },
        { value: 'premium', label: 'Premium' },
      ],
      state.premium ? 'premium' : 'classic',
      (v) => {
        if ((v === 'premium') !== state.premium) togglePremium();
      }
    ).node
  );

  // Features, Home cards and the bottom bar were three separate tabs; they all
  // answer one question — what's in the app and where does it sit — so they're
  // one scrollable Layout pane with section headings instead.
  const layoutPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('div', { class: 'gb-settings-sec-label' }, 'Features'),
    featuresPane,
    h('div', { class: 'gb-settings-sec-label' }, 'Home cards'),
    homePane,
    h('div', { class: 'gb-settings-sec-label' }, 'Bottom bar'),
    navPane,
    ...(moneyPane ? [h('div', { class: 'gb-settings-sec-label' }, 'Money'), moneyPane] : [])
  );
  displayPane.style.display = 'none';

  return { displayPane, layoutPane };
}

/* ---- Weekly review ritual ----
   A short guided look-back: the week's numbers, what went well, and one focus
   for next week. Reflections persist client-side (per ISO week). */
function weekStartKey(d) {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7; // 0 = Monday
  dt.setDate(dt.getDate() - day);
  return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
// Weekly reviews are backend-backed (synced across devices); loadData() pulls
// them into state.weeklyReviews as a { weekStart -> {wins,focus,savedAt} } map.
function loadWeekly() {
  return state.weeklyReviews || {};
}
function last7Keys() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return out;
}
/** Is a weekly review due? (weekend/Monday, not yet done, and there's something
    to actually look back on — the nudge used to greet a brand-new account on its
    first Saturday and offer to review a week that never happened.) */
function weeklyReviewDue() {
  const dow = new Date().getDay(); // 0 Sun, 1 Mon, 6 Sat
  const isWindow = dow === 0 || dow === 1 || dow === 6;
  const done = !!loadWeekly()[weekStartKey(new Date())];
  if (!isWindow || done || !state.user) return false;
  // "Something to review" means at least one number the review will actually
  // show is non-zero. Don't test activeDays — recordTrendsToday() writes a
  // zero-filled entry on every boot, so that only proves the app was opened.
  const s = weeklyReviewStats();
  return s.avgScore > 0 || s.topStreak > 0 || s.moodLogs > 0 || s.spend > 0;
}
function weeklyReviewStats() {
  const days = last7Keys();
  const byDate = (state.trends && state.trends.byDate) || {};
  const scores = days
    .map((k) => byDate[k] && Number(byDate[k].score))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const activeDays = days.filter((k) => byDate[k]).length;
  const set7 = new Set(days);
  const spend = ((state.money && state.money.expenses) || [])
    .filter((e) => set7.has(e.date))
    .reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const topStreak = (state.habits || []).reduce((mx, hb) => Math.max(mx, effectiveStreak(hb)), 0);
  const moodByDate = (state.wellness && state.wellness.moodByDate) || {};
  const moodLogs = days.filter((k) => moodByDate[k]).length;
  return { avgScore, activeDays, spend, topStreak, moodLogs };
}

function openWeeklyReview() {
  let overlay;
  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  };
  const s = weeklyReviewStats();
  const prev = loadWeekly()[weekStartKey(new Date())] || {};
  const cur = () => (state.money && state.money.currency) || '₹';

  const tile = (value, label) =>
    h(
      'div',
      { class: 'gb-wr-tile' },
      h('div', { class: 'gb-wr-tile-val' }, value),
      h('div', { class: 'gb-wr-tile-lbl' }, label)
    );

  const wins = h('textarea', {
    class: 'gb-input',
    rows: '2',
    maxlength: '400',
    placeholder: 'One thing that went well…',
  });
  // A <textarea>'s initial text can't be set via the value attribute — set the
  // property so an existing review's wins prefill when re-opened.
  wins.value = prev.wins || '';
  const focus = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'e.g. Protect my mornings for deep work',
    value: prev.focus || '',
  });
  const saveBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary' },
    prev.focus ? 'Update review' : 'Save review'
  );
  saveBtn.addEventListener('click', async () => {
    const weekStart = weekStartKey(new Date());
    const payload = { weekStart, wins: wins.value.trim(), focus: focus.value.trim() };
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const saved = await api('/api/weekly-review', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      // Mirror into state so the nudge/prefill update without a reload.
      if (!state.weeklyReviews) state.weeklyReviews = {};
      state.weeklyReviews[weekStart] = {
        wins: saved.wins,
        focus: saved.focus,
        savedAt: saved.savedAt,
      };
      toastSuccess('Weekly review saved. Here’s to next week.');
      close();
      render();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = prev.focus ? 'Update review' : 'Save review';
      toastError(err, 'Could not save your weekly review.');
    }
  });

  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Weekly review' },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Your week in review'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        'A quick look back, then set one focus for the week ahead.'
      )
    ),
    h(
      'div',
      { class: 'gb-wr-tiles' },
      tile(s.avgScore + '%', 'avg score'),
      tile(String(s.activeDays) + '/7', 'active days'),
      tile(String(s.topStreak), 'best streak'),
      tile(cur() + s.spend, 'spent'),
      tile(String(s.moodLogs), 'mood logs')
    ),
    h('div', { class: 'gb-field-label' }, 'What went well?'),
    wins,
    h('div', { class: 'gb-field-label' }, 'Your one focus for next week'),
    focus,
    saveBtn,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() },
      'Maybe later'
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  setTimeout(() => focus.focus(), 60);
}

/* ---- Delete account (destructive, password-confirmed) ---- */
function openDeleteAccount() {
  let overlay;
  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  };
  const pw = h('input', {
    type: 'password',
    class: 'gb-input',
    autocomplete: 'current-password',
    placeholder: 'Your password',
  });
  const confirmBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--danger' },
    'Delete my account'
  );
  confirmBtn.addEventListener('click', async () => {
    if (!pw.value) {
      pushToast('Enter your password to confirm.', 'error', 3000);
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await api('/api/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify({ password: pw.value }),
      });
      // Account is gone — drop the local session and return to the login screen.
      clearSession();
      state.user = null;
      close();
      location.reload();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete my account';
      toastError(err, 'Could not delete your account.');
    }
  });
  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete account' },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Delete your account?'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        'This permanently erases your habits, tasks, goals, logs and money data. It can’t be undone.'
      )
    ),
    h(
      'div',
      { class: 'gb-form' },
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Confirm with your password'),
      pw,
      confirmBtn
    ),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() },
      'Keep my account'
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  setTimeout(() => pw.focus(), 60);
}

/* ---- Security modal: active sessions + change password ---- */
/* ---- Security section ----
   Signed-in devices + password change. Used to be its own modal reachable from
   a third "Security" item in the account menu; it's a section of Settings →
   Account now. Returns the nodes; the caller mounts them. */
function securitySection() {
  const sessionsWrap = h(
    'div',
    { class: 'gb-sec-sessions' },
    h('div', { class: 'gb-empty-sm' }, 'Loading…')
  );

  async function loadSessions() {
    try {
      const list = await api('/api/auth/sessions');
      if (!list.length) {
        sessionsWrap.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'No active sessions.'));
        return;
      }
      sessionsWrap.replaceChildren(
        ...list.map((s) =>
          h(
            'div',
            { class: 'gb-sec-row' },
            h(
              'div',
              { class: 'gb-sec-row-main' },
              h('div', { class: 'gb-sec-row-device' }, s.device || 'Unknown device'),
              h(
                'div',
                { class: 'gb-sec-row-meta' },
                (s.ip || 'unknown IP') + ' · last used ' + relativeTime(s.lastUsedAt)
              )
            ),
            s.current
              ? h('span', { class: 'gb-sec-badge' }, 'This device')
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--ghost gb-btn--compact',
                    onclick: async (e) => {
                      e.target.disabled = true;
                      try {
                        await api('/api/auth/sessions/' + encodeURIComponent(s.id), {
                          method: 'DELETE',
                        });
                        toastSuccess('Signed out that device.');
                        loadSessions();
                      } catch (err) {
                        toastError(err, 'Could not sign out that device.');
                      }
                    },
                  },
                  'Sign out'
                )
          )
        )
      );
    } catch (_) {
      sessionsWrap.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Could not load sessions.'));
    }
  }

  const curPw = h('input', {
    type: 'password',
    class: 'gb-input',
    autocomplete: 'current-password',
  });
  const newPw = h('input', { type: 'password', class: 'gb-input', autocomplete: 'new-password' });
  const pwBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary' }, 'Update password');
  async function changePassword() {
    const currentPassword = curPw.value;
    const newPassword = newPw.value;
    if (!currentPassword || newPassword.length < 8) {
      pushToast('Enter your current password and a new one (8+ characters).', 'error', 3600);
      return;
    }
    pwBtn.disabled = true;
    pwBtn.textContent = 'Updating…';
    try {
      const resp = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // Password change revoked all sessions and minted a fresh token — store it
      // so this device stays signed in.
      syncUserSession(resp);
      toastSuccess('Password updated. Other devices were signed out.');
      curPw.value = '';
      newPw.value = '';
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
      loadSessions();
    } catch (err) {
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
      toastError(err, 'Could not update password.');
    }
  }
  pwBtn.addEventListener('click', changePassword);

  loadSessions();
  return [
    h('div', { class: 'gb-settings-sec-label' }, 'Signed-in devices'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '10px' } },
      'Sign out any device you no longer use.'
    ),
    sessionsWrap,
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '20px' } }, 'Change password'),
    h(
      'div',
      { class: 'gb-form' },
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Current password'),
      curPw,
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'New password (8+ characters)'),
      newPw,
      pwBtn
    ),
  ];
}

/* A mentor can open their mentee's tasks and habit streaks; the mentee sees
   nothing back. This is the mentee's side of that: switch it off and the
   endpoint answers 403 instead. Unset means on, so nobody's existing
   connection quietly goes dark on the day this shipped. */
function shareProgressRow() {
  const isOn = () => !(state.user && state.user.uiPrefs && state.user.uiPrefs.shareProgress === false);
  const sw = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': isOn() ? 'true' : 'false',
      'aria-label': 'Let my mentor see my progress',
      class: 'gb-switch' + (isOn() ? ' is-on' : ''),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  sw.onclick = () => {
    const next = !isOn();
    sw.classList.toggle('is-on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    saveUiPrefs({ shareProgress: next });
    toastSuccess(next ? 'Your mentor can see your progress.' : 'Your progress is private now.');
  };
  return h(
    'div',
    { class: 'gb-feature-row' },
    h(
      'div',
      { class: 'gb-feature-row-text' },
      h('div', { class: 'gb-feature-row-label' }, 'Let my mentor see my progress'),
      h(
        'div',
        { class: 'gb-feature-row-desc' },
        'Your tasks and habit streaks. People you mentor never see yours.'
      )
    ),
    sw
  );
}

/* ---- Settings modal (Profile / Alerts / Account) ---- */
function openProfileSettings(initialTab) {
  const u = state.user || {};
  const now = new Date();

  // ---- Personal inputs ----
  const displayNameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'Your display name',
    value: u.displayName || '',
  });
  const fallbackDob = u.dob
    ? String(u.dob)
    : u.ageYears
      ? now.getFullYear() - Number(u.ageYears) + '-01-01'
      : '';
  const dobInput = h('input', { type: 'date', class: 'gb-input', value: fallbackDob });
  const heightInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '100',
    max: '250',
    placeholder: 'cm',
    value: u.heightCm || '',
  });
  const weightInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '25',
    max: '300',
    placeholder: 'kg',
    value: u.weightKg || '',
  });
  const GENDERS = ['', 'Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const genderSel = h('select', { class: 'gb-input' });
  GENDERS.forEach((g) => {
    const o = h('option', { value: g }, g || 'Select gender…');
    if ((u.gender || '') === g) o.selected = true;
    genderSel.appendChild(o);
  });
  const timezoneInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '64',
    placeholder: 'e.g. Asia/Kolkata',
    value: u.timezone || '',
  });

  // ---- Diet & Goals inputs ----
  const fitnessGoalInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '100',
    placeholder: 'e.g. lose weight, build muscle, stay active',
    value: u.fitnessGoal || '',
  });
  const dietInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '64',
    placeholder: 'e.g. vegetarian, eggetarian, high-protein',
    value: u.dietPreference || '',
  });
  const foodGoalInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '800',
    max: '6000',
    placeholder: 'kcal',
    value: u.dailyFoodGoalKcal || '',
  });
  const waterGoalInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '1000',
    max: '7000',
    placeholder: 'ml',
    value: u.dailyWaterGoalMl || '',
  });
  const allergicInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '255',
    placeholder: 'e.g. peanuts, lactose, gluten',
    value: u.allergicTo || '',
  });
  const favDishInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'e.g. paneer butter masala',
    value: u.favouriteDish || '',
  });
  const aboutInput = h(
    'textarea',
    {
      class: 'gb-input gb-input--about',
      maxlength: '500',
      placeholder: 'Your routine, health priorities, dietary preferences…',
    },
    u.aboutMe || ''
  );
  // Parse a number input to an integer within [min,max], else null (so the
  // backend's validation never 400s on a blank / out-of-range field).
  const numOrNull = (raw, min, max) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  };
  const ageFromDob = (raw) => {
    if (!raw) return null;
    const dob = new Date(raw + 'T00:00:00');
    if (Number.isNaN(dob.getTime())) return null;
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age >= 10 && age <= 100 ? age : null;
  };
  const suggestBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--secondary gb-profile-suggest-btn',
      onclick: async () => {
        suggestBtn.disabled = true;
        suggestBtn.textContent = 'Generating…';
        try {
          // Send what's currently on screen so unsaved edits (allergy, about…) are honoured.
          const s = await getNutritionSuggestion({
            ageYears: ageFromDob(dobInput.value),
            heightCm: numOrNull(heightInput.value, 100, 250),
            weightKg: numOrNull(weightInput.value, 25, 300),
            fitnessGoal: (fitnessGoalInput.value || '').trim() || null,
            dietPreference: (dietInput.value || '').trim() || null,
            aboutMe: (aboutInput.value || '').trim() || null,
            allergicTo: (allergicInput.value || '').trim() || null,
            favouriteDish: (favDishInput.value || '').trim() || null,
            dailyFoodGoalKcal: numOrNull(foodGoalInput.value, 800, 6000),
            dailyWaterGoalMl: numOrNull(waterGoalInput.value, 1000, 7000),
          });
          openModal({
            title: 'AI Nutrition Suggestion',
            modalClass: 'gb-modal--settings',
            body: h(
              'div',
              { class: 'gb-profile-suggest' },
              h(
                'div',
                { class: 'gb-profile-suggest-line' },
                'Water goal: ' + s.recommendedWaterMl + ' ml/day'
              ),
              h(
                'div',
                { class: 'gb-profile-suggest-line' },
                'Food goal: ' + s.recommendedFoodGoalKcal + ' kcal/day'
              ),
              h('div', { class: 'gb-profile-suggest-line' }, s.guidance || ''),
              h(
                'ul',
                { class: 'gb-profile-suggest-list' },
                (s.indianFoodSuggestions || []).map((item) => h('li', null, item))
              )
            ),
            primary: 'Use these goals',
            onPrimary: () => {
              if (s.recommendedWaterMl) waterGoalInput.value = String(s.recommendedWaterMl);
              if (s.recommendedFoodGoalKcal)
                foodGoalInput.value = String(s.recommendedFoodGoalKcal);
              toastSuccess('Suggested goals applied. Save to keep them.');
            },
          });
        } catch (err) {
          toastError(
            new Error(err && err.message ? err.message : 'Could not generate suggestion.'),
            'Suggestion error'
          );
        } finally {
          suggestBtn.disabled = false;
          suggestBtn.textContent = 'Get AI nutrition suggestion';
        }
      },
    },
    'Get AI nutrition suggestion'
  );

  // ---- WhatsApp OTP section (self-contained) ----
  let waOtpPhone = u.whatsappNumber || '';
  let waStage = u.whatsappVerified && u.whatsappNumber ? 'verified' : 'idle';
  const waSectionBody = h('div', { class: 'gb-wa-otp-section' });

  function buildWaSection() {
    const cu = state.user || {};
    waSectionBody.replaceChildren();

    if (waStage === 'idle') {
      const phone = CountryPhoneInput(waOtpPhone || cu.whatsappNumber || '');
      const sendBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { marginTop: '10px' },
        },
        'Send verification code'
      );
      sendBtn.onclick = async () => {
        const raw = phone.getValue();
        if (!/^\+?[1-9]\d{7,14}$/.test(raw)) {
          phone.focus();
          toastError(
            new Error('Enter a valid phone number for the selected country.'),
            'Invalid number'
          );
          return;
        }
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        try {
          await api('/api/auth/whatsapp/send-otp', {
            method: 'POST',
            body: JSON.stringify({ number: raw }),
          });
          waOtpPhone = raw;
          waStage = 'otp_sent';
          buildWaSection();
        } catch (err) {
          toastError(err, 'Could not send OTP');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send verification code';
        }
      };
      waSectionBody.appendChild(h('div', { class: 'gb-field-label' }, 'WhatsApp number'));
      waSectionBody.appendChild(
        h('div', { class: 'gb-field-hint' }, 'Pick your country, then enter the local number')
      );
      waSectionBody.appendChild(phone.el);
      waSectionBody.appendChild(sendBtn);
    } else if (waStage === 'otp_sent') {
      const otpIn = h('input', {
        type: 'text',
        class: 'gb-input',
        maxlength: '6',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
      });
      const otpField = otpBoxes(otpIn);
      otpIn.addEventListener('input', () => otpIn.classList.remove('is-invalid'));
      const verifyBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { flex: '1' },
        },
        'Verify'
      );
      verifyBtn.onclick = async () => {
        const otp = (otpIn.value || '').trim();
        if (!/^\d{6}$/.test(otp)) {
          otpIn.classList.add('is-invalid');
          otpIn.focus();
          shakeRefusal(otpField);
          toastError(new Error('Enter the 6-digit code from WhatsApp'), 'Invalid code');
          return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying…';
        otpField.classList.add('is-busy');
        try {
          const updated = await api('/api/auth/whatsapp/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ number: waOtpPhone, otp }),
          });
          syncUserSession(updated);
          waStage = 'verified';
          buildWaSection();
          toastSuccess('WhatsApp number verified! Reminders are now active.');
        } catch (err) {
          otpField.classList.remove('is-busy');
          otpIn.classList.add('is-invalid');
          shakeRefusal(otpField);
          toastError(err, 'Verification failed');
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }
      };
      const resendBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          style: { flex: '0 0 auto' },
        },
        'Resend'
      );
      resendBtn.onclick = async () => {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending…';
        try {
          await api('/api/auth/whatsapp/send-otp', {
            method: 'POST',
            body: JSON.stringify({ number: waOtpPhone }),
          });
          toastSuccess('A new code was sent to ' + waOtpPhone);
        } catch (err) {
          toastError(err, 'Could not resend');
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend';
        }
      };
      const changeBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-wa-change-link',
        },
        'Change number'
      );
      changeBtn.onclick = () => {
        waStage = 'idle';
        buildWaSection();
      };
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-wa-otp-sent-chip' },
          Icon('message-circle', { size: 14, color: 'var(--gb-wa-green)' }),
          'Code sent to ' + waOtpPhone
        )
      );
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-field-label', style: { marginTop: '14px' } },
          'Enter the 6-digit code'
        )
      );
      waSectionBody.appendChild(otpField);
      waSectionBody.appendChild(h('div', { class: 'gb-wa-otp-actions' }, verifyBtn, resendBtn));
      waSectionBody.appendChild(changeBtn);
      setTimeout(() => {
        if (otpIn.isConnected) otpIn.focus();
      }, 50);
    } else if (waStage === 'verified') {
      const verifiedChip = h(
        'div',
        { class: 'gb-wa-verified-chip' },
        Icon('check-circle-2', { size: 14, color: 'var(--gb-wa-green)' }),
        maskPhone(cu.whatsappNumber),
        h('span', { class: 'gb-wa-verified-label' }, 'Verified')
      );
      const changeBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-wa-change-link',
          style: { marginLeft: 'auto' },
        },
        'Change number'
      );
      changeBtn.onclick = () => {
        waStage = 'idle';
        buildWaSection();
      };

      let waEnabled = !!cu.whatsappEnabled;
      const tThumb = h('span', { class: 'gb-wa-toggle-thumb' });
      const waToggle = h(
        'button',
        {
          type: 'button',
          class: 'gb-wa-toggle' + (waEnabled ? ' is-on' : ''),
          role: 'switch',
          'aria-checked': String(waEnabled),
          onclick: async () => {
            waEnabled = !waEnabled;
            waToggle.classList.toggle('is-on', waEnabled);
            waToggle.setAttribute('aria-checked', String(waEnabled));
            try {
              const updated = await api('/api/auth/whatsapp', {
                method: 'PUT',
                body: JSON.stringify({ enabled: waEnabled }),
              });
              syncUserSession(updated);
              toastSuccess(
                waEnabled ? 'WhatsApp reminders enabled.' : 'WhatsApp reminders paused.'
              );
            } catch (err) {
              waEnabled = !waEnabled;
              waToggle.classList.toggle('is-on', waEnabled);
              waToggle.setAttribute('aria-checked', String(waEnabled));
              toastError(err, 'Could not update WhatsApp settings.');
            }
          },
        },
        tThumb
      );

      waSectionBody.appendChild(h('div', { class: 'gb-wa-number-row' }, verifiedChip, changeBtn));
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-wa-toggle-row' },
          h(
            'div',
            null,
            h(
              'div',
              { class: 'gb-field-label', style: { marginBottom: '2px' } },
              'Enable WhatsApp reminders'
            ),
            h(
              'div',
              { class: 'gb-field-hint' },
              'Timed calendar reminders will be sent to your WhatsApp'
            )
          ),
          waToggle
        )
      );
    }

    refreshIcons();
  }
  buildWaSection();

  // ---- Avatar header ----
  const initials = (u.displayName || u.email || 'B')[0].toUpperCase();

  // ---- Tab panes ----
  const profilePane = h(
    'div',
    { class: 'gb-settings-pane' },
    h('div', { class: 'gb-settings-sec-label' }, 'Personal'),
    h('div', { class: 'gb-field-label' }, 'Display name'),
    displayNameInput,
    h('div', { class: 'gb-field-label' }, 'Date of birth'),
    dobInput,
    h(
      'div',
      { class: 'gb-settings-2col' },
      h('div', null, h('div', { class: 'gb-field-label' }, 'Height (cm)'), heightInput),
      h('div', null, h('div', { class: 'gb-field-label' }, 'Weight (kg)'), weightInput)
    ),
    h('div', { class: 'gb-field-label' }, 'Gender'),
    genderSel,
    h('div', { class: 'gb-field-label' }, 'Timezone'),
    h('div', { class: 'gb-field-hint' }, 'e.g. Asia/Kolkata or America/New_York'),
    timezoneInput,
    h('div', { class: 'gb-settings-sec-label' }, 'Diet & Goals'),
    h('div', { class: 'gb-field-label' }, 'Fitness goal'),
    fitnessGoalInput,
    h('div', { class: 'gb-field-label' }, 'Diet preference'),
    dietInput,
    h(
      'div',
      { class: 'gb-settings-2col' },
      h(
        'div',
        null,
        h('div', { class: 'gb-field-label' }, 'Daily food goal (kcal)'),
        foodGoalInput
      ),
      h('div', null, h('div', { class: 'gb-field-label' }, 'Daily water goal (ml)'), waterGoalInput)
    ),
    h('div', { class: 'gb-field-label' }, 'Allergic to'),
    allergicInput,
    h('div', { class: 'gb-field-label' }, 'Favourite dish'),
    favDishInput,
    h('div', { class: 'gb-field-label' }, 'About you'),
    aboutInput,
    suggestBtn
  );

  // ---- Progress digest controls ----
  const digestFreqSel = h(
    'select',
    { class: 'gb-input' },
    ['off', 'daily', 'weekly'].map((f) => {
      const label = f === 'off' ? 'Off' : f[0].toUpperCase() + f.slice(1);
      const o = h('option', { value: f }, label);
      if ((u.digestFrequency || 'off') === f) o.selected = true;
      return o;
    })
  );
  const digestHourSel = h('select', { class: 'gb-input' });
  for (let hr = 0; hr < 24; hr++) {
    const ampm = hr < 12 ? 'AM' : 'PM';
    const h12 = hr % 12 === 0 ? 12 : hr % 12;
    const o = h('option', { value: String(hr) }, h12 + ':00 ' + ampm);
    if ((u.digestHour != null ? u.digestHour : 8) === hr) o.selected = true;
    digestHourSel.appendChild(o);
  }
  // Saves on change, like the WhatsApp toggle above it and every other control
  // outside the Profile tab. A Save button here was the one thing in Settings
  // that made you press something twice, and "Done" doesn't commit it.
  const saveDigest = async () => {
    digestFreqSel.disabled = true;
    digestHourSel.disabled = true;
    try {
      await saveDigestPrefs(digestFreqSel.value, parseInt(digestHourSel.value, 10));
      toastSuccess('Digest preferences saved.');
    } catch (err) {
      toastError(err, 'Could not save digest preferences.');
    } finally {
      digestFreqSel.disabled = false;
      digestHourSel.disabled = false;
    }
  };
  digestFreqSel.onchange = saveDigest;
  digestHourSel.onchange = saveDigest;
  const digestSectionBody = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Frequency'),
    digestFreqSel,
    h('div', { class: 'gb-field-label' }, 'Send around'),
    digestHourSel,
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '6px' } },
      'Weekly digests arrive Mondays — by email, in-app and push.'
    )
  );

  // ---- Working week ----
  // Decides which days a "Mon-Fri" reminder actually fires on. It was hardcoded
  // Mon-Fri on both sides, which is simply wrong for Sun-Thu in the Gulf and for
  // the Mon-Sat offices plenty of people here work. Lives in ui_prefs rather than
  // its own column because prod runs ddl-auto: none.
  const workWeekSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Working week' },
    Object.keys(WORK_WEEKS).map((key) => {
      const o = h('option', { value: key }, WORK_WEEKS[key].label);
      if (getWorkWeek() === key) o.selected = true;
      return o;
    })
  );
  workWeekSel.onchange = () => {
    setWorkWeek(workWeekSel.value);
    saveUiPrefs({ workWeek: workWeekSel.value });
    toastSuccess('Working week saved.');
    // Every "Mon-Fri" reminder now lands on different days, so anything already
    // painted from the old answer is stale.
    if (state.screen === 'calendar' || state.screen === 'home') render();
  };
  const workWeekBody = h(
    'div',
    null,
    workWeekSel,
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '6px' } },
      'Reminders set to repeat on working days follow this.'
    )
  );

  // ---- Push notifications ----
  const pushBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact' },
    'Enable push notifications'
  );
  const pushTestBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact' },
    'Send test'
  );
  let pushOn = false;
  // In the app the switch is Android's, not ours: we can ask for permission but
  // never take it back, so the "off" button points at system settings instead.
  const native = localNotificationsAvailable();
  const syncPushUi = () => {
    pushBtn.textContent = pushOn
      ? native
        ? 'Notifications on — manage in system settings'
        : 'Turn off push notifications'
      : 'Enable notifications';
    pushBtn.disabled = pushOn && native;
    pushTestBtn.style.display = pushOn ? '' : 'none';
  };
  syncPushUi();
  if (pushSupported())
    pushSubscribed().then((on) => {
      pushOn = on;
      syncPushUi();
    });
  pushBtn.onclick = async () => {
    if (!pushSupported()) {
      pushToast('This browser doesn’t support push notifications.', 'error', 3600);
      return;
    }
    pushBtn.disabled = true;
    try {
      if (pushOn) {
        await disablePush(api);
        pushOn = false;
        toastSuccess('Push notifications turned off.');
      } else {
        const r = await enablePush(api);
        if (r === 'ok') {
          pushOn = true;
          toastSuccess('Push notifications on. Try “Send test”.');
        } else if (r === 'unconfigured') {
          pushToast('Push isn’t set up on the server yet (no VAPID keys).', 'error', 4200);
        } else if (r === 'denied') {
          pushToast(
            native
              ? 'Notifications are blocked — turn them on in Settings › Apps › Growth Buddy.'
              : 'Notifications are blocked — enable them in your browser settings.',
            'error',
            4200
          );
        } else if (r === 'unsupported') {
          pushToast('This browser doesn’t support push notifications.', 'error', 4200);
        } else {
          pushToast('Could not enable push. Please try again.', 'error', 3600);
        }
      }
    } finally {
      syncPushUi();
    }
  };
  pushTestBtn.onclick = async () => {
    try {
      if (native) {
        toastSuccess(
          (await pushTestLocal())
            ? 'Test notification sent.'
            : 'Could not post the notification.'
        );
        return;
      }
      const r = await api('/api/push/test', { method: 'POST' });
      toastSuccess(
        r.delivered > 0
          ? 'Test sent to ' + r.delivered + ' device' + (r.delivered > 1 ? 's' : '') + '.'
          : 'No devices registered yet.'
      );
    } catch (err) {
      toastError(err, 'Could not send a test notification.');
    }
  };
  const pushSectionBody = h(
    'div',
    { class: 'gb-quickadd-row', style: { flexWrap: 'wrap' } },
    pushBtn,
    pushTestBtn
  );

  const notifPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('div', { class: 'gb-settings-sec-label' }, 'Push notifications'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '12px' } },
      'Get reminders and nudges on this device, even when the app is closed.'
    ),
    pushSectionBody,
    h(
      'div',
      { class: 'gb-settings-sec-label', style: { marginTop: '22px' } },
      'WhatsApp reminders'
    ),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '14px' } },
      'Verify your number once — timed reminders then arrive on WhatsApp.'
    ),
    waSectionBody,
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '22px' } }, 'Progress digest'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '12px' } },
      'Get a short recap of your score, tasks and habits to stay on track.'
    ),
    digestSectionBody,
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '22px' } }, 'Working week'),
    workWeekBody
  );

  // ---- Account pane ----
  const verifiedChip = h(
    'span',
    { class: 'gb-pill', style: { background: 'var(--leaf-50)', color: 'var(--leaf-700)' } },
    u.emailVerified ? 'Verified' : 'Unverified'
  );
  const accountPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('div', { class: 'gb-settings-sec-label' }, 'Account'),
    h(
      'div',
      { class: 'gb-account-row' },
      h('div', { class: 'gb-field-label' }, 'Email'),
      h(
        'div',
        { class: 'gb-account-value' },
        h('span', { class: 'gb-account-email' }, u.email || '—'),
        verifiedChip
      )
    ),
    h(
      'div',
      { class: 'gb-account-row' },
      h('div', { class: 'gb-field-label' }, 'Progress'),
      h(
        'div',
        { class: 'gb-account-value' },
        'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP'
      )
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-account-signout',
        onclick: () => logout(),
      },
      Icon('log-out', { size: 16 }),
      'Sign out'
    ),
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '20px' } }, 'Privacy'),
    shareProgressRow(),
    ...securitySection(),
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '20px' } }, 'Danger zone'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '10px' } },
      'Permanently delete your account and all your data. This cannot be undone.'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-account-signout is-danger',
        onclick: () => openDeleteAccount(),
      },
      Icon('trash-2', { size: 16 }),
      'Delete account'
    ),
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '20px' } }, 'About'),
    h('div', { class: 'gb-field-hint' }, 'Growth Buddy · v1.0.0')
  );

  // ---- Top-level segmented slider nav ----
  // One door for everything a person can change about the app. Display and
  // Layout came from the old Customise modal; Security folded into Account.
  const { displayPane, layoutPane } = customisePanes();
  const tabDefs = [
    { id: 'profile', label: 'Profile', pane: profilePane },
    { id: 'display', label: 'Display', pane: displayPane },
    { id: 'notifications', label: 'Alerts', pane: notifPane },
    { id: 'layout', label: 'Layout', pane: layoutPane },
    { id: 'account', label: 'Account', pane: accountPane },
  ];
  const activeTab = tabDefs.some((t) => t.id === initialTab) ? initialTab : 'profile';
  const tabBar = buildSegSlider(tabDefs, activeTab);

  const body = h(
    'div',
    { class: 'gb-settings-body' },
    h(
      'div',
      { class: 'gb-settings-profile-header' },
      h('div', { class: 'gb-settings-avatar-circle' }, initials),
      h(
        'div',
        { class: 'gb-settings-profile-info' },
        h('div', { class: 'gb-settings-profile-name' }, u.displayName || 'Buddy'),
        h('div', { class: 'gb-settings-profile-email' }, u.email || ''),
        h(
          'span',
          { class: 'gb-settings-level-badge' },
          'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP'
        )
      )
    ),
    tabBar,
    // Panes must be mounted in tab order — buildSegSlider only toggles display.
    profilePane,
    displayPane,
    notifPane,
    layoutPane,
    accountPane
  );

  openModal({
    // "Done", not "Save changes": every tab but Profile saves the moment you
    // touch it, so a Save button that only commits the Profile fields would be
    // lying on the other four. It still saves them — it just doesn't claim to
    // be the reason anything else stuck.
    title: 'Settings',
    sub: null,
    body,
    primary: 'Done',
    modalClass: 'gb-modal--settings',
    onPrimary: async () => {
      const parseDobToAge = (raw, ref) => {
        if (!raw) return null;
        const dob = new Date(raw + 'T00:00:00');
        if (Number.isNaN(dob.getTime())) {
          if (ref) ref.focus();
          throw new Error('Date of birth is invalid.');
        }
        let age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
        if (age < 10 || age > 100) {
          if (ref) ref.focus();
          throw new Error('Age must be between 10 and 100.');
        }
        return age;
      };
      const parseRanged = (label, raw, min, max, ref) => {
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min || n > max) {
          if (ref) ref.focus();
          throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
        }
        return Math.round(n);
      };

      const profilePayload = {
        displayName: (displayNameInput.value || '').trim() || null,
        timezone: (timezoneInput.value || '').trim() || null,
        dob: dobInput.value || null,
        ageYears: parseDobToAge(dobInput.value, dobInput),
        heightCm: parseRanged('Height', heightInput.value, 100, 250, heightInput),
        weightKg: parseRanged('Weight', weightInput.value, 25, 300, weightInput),
        gender: genderSel.value || '' || null,
        fitnessGoal: (fitnessGoalInput.value || '').trim() || null,
        dietPreference: (dietInput.value || '').trim() || null,
        allergicTo: (allergicInput.value || '').trim() || null,
        favouriteDish: (favDishInput.value || '').trim() || null,
        aboutMe: (aboutInput.value || '').trim() || null,
        dailyFoodGoalKcal: parseRanged(
          'Daily food goal',
          foodGoalInput.value,
          800,
          6000,
          foodGoalInput
        ),
        dailyWaterGoalMl: parseRanged(
          'Daily water goal',
          waterGoalInput.value,
          1000,
          7000,
          waterGoalInput
        ),
      };

      await saveProfileDetails(profilePayload);
    },
  });
}

async function getNutritionSuggestion(form) {
  return api('/api/auth/nutrition-suggestion', {
    method: 'POST',
    body: JSON.stringify(form || {}),
  });
}

/* ---- Calendar / reminder handlers ---- */
function syncSelectedDateToVisibleMonth() {
  const parts = String(state.selectedDate || '')
    .split('-')
    .map(Number);
  const day = Number.isFinite(parts[2]) ? parts[2] : 1;
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
  state.selectedDate = dateKey(state.calYear, state.calMonth, Math.min(day, daysInMonth));
}

function rerenderCalendarToolbarIfActive() {
  if (state.screen !== 'calendar') return false;
  const oldToolbar = document.querySelector('.gb-cal-toolbar');
  if (!oldToolbar || !RenderCalendarToolbar) {
    return false;
  }
  const fresh = RenderCalendarToolbar({
    year: state.calYear,
    month: state.calMonth,
    reminders: state.reminders,
    tasks: state.tasks,
    onPrevMonth: calPrevMonth,
    onNextMonth: calNextMonth,
    onToday: calToday,
  });
  oldToolbar.replaceWith(fresh);
  refreshIcons();
  return true;
}

function rerenderCalendarMonthInPlace() {
  syncSelectedDateToVisibleMonth();
  const updated = rerenderCalendarToolbarIfActive();
  repaintCalendarGrid();
  rerenderCalendarSideIfActive();
  loadCalendarFoodForDate(state.selectedDate);
  if (!updated) render();
}

function calPrevMonth() {
  if (state.calMonth === 0) {
    state.calMonth = 11;
    state.calYear -= 1;
  } else {
    state.calMonth -= 1;
  }
  if (state.screen === 'calendar') {
    rerenderCalendarMonthInPlace();
    return;
  }
  if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
    return;
  }
  render();
}

function calNextMonth() {
  if (state.calMonth === 11) {
    state.calMonth = 0;
    state.calYear += 1;
  } else {
    state.calMonth += 1;
  }
  if (state.screen === 'calendar') {
    rerenderCalendarMonthInPlace();
    return;
  }
  if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
    return;
  }
  render();
}

function calToday() {
  const t = new Date();
  state.calYear = t.getFullYear();
  state.calMonth = t.getMonth();
  state.selectedDate = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
  if (state.screen === 'calendar') {
    // Today CHANGES THE MONTH, so it needs the month-level repaint — the same
    // one the < > arrows use. It used to call repaintCalendarGrid(), which
    // replaces `.gb-cal-card` and nothing else: browse to March, hit Today, and
    // you got September's grid under a "March 2026" toolbar, with the days
    // landing on the right weekdays so the only wrong thing on screen was the
    // title. Anything that moves calYear/calMonth goes through here.
    rerenderCalendarMonthInPlace();
    return;
  }
  if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
    // mini calendar updated in place
  } else {
    render();
  }
  loadCalendarFoodForDate(state.selectedDate);
}

/**
 * Day click: surgical update only. Toggle the selected-cell class on
 * the grid and rebuild the side panel in place. The form DOM is
 * preserved (module-cached) so any text the user typed survives.
 */
function selectDate(key) {
  if (state.selectedDate === key) return;
  state.selectedDate = key;
  if (state.screen === 'calendar') {
    updateCalendarDaySelection(key);
    rerenderCalendarSideIfActive();
  } else if (state.screen === 'home') {
    if (!rerenderHomeMiniCalendarIfActive()) {
      render();
    }
  } else {
    render();
  }
  loadCalendarFoodForDate(key);
}

function retryCalendarFoodDate(key) {
  loadCalendarFoodForDate(key, { force: true });
}

// One add at a time. The form's own button disables itself, but Enter-to-submit
// and the quick-add path reach this too, and every caller wants the same answer
// to a second click: nothing.
let addingReminder = false;

async function addReminder(key, text, time, tag, repeat, until) {
  if (!text || addingReminder) return;
  // A day that has already gone takes no reminders at all — the calendar hides
  // the form on past days, and this is the same rule for every other caller.
  // The anchor date is what a recurrence counts from, so an anchor in the past
  // is a series the user never got to choose the start of.
  if (key < todayKeyNow()) {
    toastError(
      new Error('That day has already passed — pick today or later.'),
      'Could not add reminder.'
    );
    return;
  }
  // Today, but at an hour that has gone. A recurring one still fires — "daily at
  // 8am" set up at 10am has tomorrow — so only the single occurrence is refused.
  if ((repeat || 'none') === 'none' && isPastSlot(key, time)) {
    toastError(
      new Error('That time has already passed — pick a later one.'),
      'Could not add reminder.'
    );
    return;
  }
  addingReminder = true;
  try {
    const body = {
      text: text,
      date: key,
      time: time || null,
      tag: tag || 'personal',
      repeat: repeat || 'none',
      until: until || null,
    };
    const created = await api('/api/reminders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    state.reminders.push(created);
    resetCalendarForm();
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      // Repaint the month grid's dot indicators for the affected day.
      repaintCalendarGrid();
    } else {
      render();
    }
    toastSuccess('Reminder added.');
  } catch (err) {
    toastError(err, 'Could not add reminder.');
  } finally {
    addingReminder = false;
  }
}

/**
 * Repaint just the month grid (dots + counts) in place. Used after
 * adding/deleting reminders so the side panel — and form DOM — stays
 * stable. Falls back to full render if the grid isn't mounted.
 */
function repaintCalendarGrid() {
  if (state.screen !== 'calendar') return;
  const grid = document.querySelector('.gb-cal-card');
  if (!grid || !RenderCalendarGrid) {
    render();
    return;
  }
  const fresh = RenderCalendarGrid({
    year: state.calYear,
    month: state.calMonth,
    selectedDate: state.selectedDate,
    reminders: state.reminders,
    onSelectDate: selectDate,
  });
  grid.replaceWith(fresh);
  refreshIcons();
}

// scope: 'all' | 'this' | 'future' | 'before'
async function deleteReminder(scope, id, occKey) {
  const repaint = () => {
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      repaintCalendarGrid();
    } else {
      render();
    }
  };
  const previous = state.reminders;
  const whole = (scope || 'all') === 'all';
  // Deleting the whole series is the one case whose outcome we can work out
  // locally, so the row goes now and the request follows. The occurrence scopes
  // depend on the server's skip list, so they still wait for the refetch.
  if (whole) {
    state.reminders = previous.filter((r) => r.id !== id);
    repaint();
  }
  try {
    const qs = new URLSearchParams();
    qs.set('scope', scope || 'all');
    if (occKey) {
      qs.set('date', occKey);
    }
    await api('/api/reminders/' + encodeURIComponent(id) + '?' + qs.toString(), {
      method: 'DELETE',
    });
    if (!whole) {
      state.reminders = await api('/api/reminders');
      repaint();
    }
    toastSuccess('Reminder deleted.');
  } catch (err) {
    // Put it back: the row is gone from the screen but not from the server.
    state.reminders = previous;
    repaint();
    toastError(err, 'Could not delete reminder.');
  }
}

/* ---- Modal scaffolding ---- */
function openModal({ title, sub, body, primary, onPrimary, modalClass }) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }
  const primaryBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      style: { width: '100%', marginTop: '14px' },
      onclick: async () => {
        try {
          primaryBtn.disabled = true;
          await onPrimary();
          close();
          render();
        } catch (err) {
          primaryBtn.disabled = false;
          // The modal refused what you gave it, so the modal is what shakes —
          // the same head-shake the sign-in card does.
          shakeRefusal(sheet);
          toastError(err, 'Something went wrong.');
        }
      },
    },
    primary || 'Save'
  );
  const sheet = h(
    'div',
    {
      class: 'gb-modal' + (modalClass ? ' ' + modalClass : ''),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, title),
      sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
    ),
    h('div', { class: 'gb-modal-body' }, body),
    primaryBtn,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function segmented(options, initial, onChange) {
  let selected = initial;
  const segs = {};
  const wrap = h('div', { class: 'gb-segmented', role: 'radiogroup' });
  options.forEach((opt) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-seg' + (opt.value === selected ? ' is-on' : ''),
        role: 'radio',
        'aria-checked': String(opt.value === selected),
        onclick: () => {
          selected = opt.value;
          for (const k in segs) {
            const on = k === opt.value;
            segs[k].classList.toggle('is-on', on);
            segs[k].setAttribute('aria-checked', String(on));
          }
          if (onChange) onChange(opt.value);
        },
      },
      opt.label
    );
    segs[opt.value] = btn;
    wrap.appendChild(btn);
  });
  return { node: wrap, get: () => selected };
}

function openAddSheet() {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }

  // Natural-language quick-add: type it once, we sort it into the right trackers.
  const qaInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. spent 200 on lunch, slept 7h, drank a bottle of water',
    'aria-label': 'Quick log in your own words',
  });
  const qaBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact' },
    'Log it'
  );
  async function submitQuickAdd() {
    const text = qaInput.value.trim();
    if (!text) return;
    qaBtn.disabled = true;
    qaInput.disabled = true;
    qaBtn.textContent = 'Logging…';
    try {
      const r = await runQuickAdd(text);
      close();
      if (!r.configured) {
        pushToast('Quick add needs an AI key configured on the server.', 'error', 3600);
      } else if (r.applied > 0) {
        toastSuccess(r.note || 'Logged ' + r.applied + (r.applied > 1 ? ' things.' : ' thing.'));
        await loadData();
      } else {
        pushToast("Couldn't find anything to log there — try being more specific.", 'error', 3600);
      }
    } catch (err) {
      qaBtn.disabled = false;
      qaInput.disabled = false;
      qaBtn.textContent = 'Log it';
      toastError(err, 'Quick add failed. Try again?');
    }
  }
  qaBtn.addEventListener('click', submitQuickAdd);
  qaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitQuickAdd();
    }
  });

  // Voice input. Speech-to-text transcribes one language at a time, so we
  // default to the device's own language — people just talk the way they talk —
  // with a picker for the rest (choice remembered). Browsers use the Web
  // Speech API; the Capacitor app's WebView doesn't ship it, so there the
  // native SpeechRecognition plugin takes over.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const capSR =
    window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  let micBtn = null;
  let langBtn = null;
  if (SR || capSR) {
    const LANGS = [
      { code: 'en-IN', label: 'English' },
      { code: 'hi-IN', label: 'हिन्दी' },
      { code: 'ta-IN', label: 'தமிழ்' },
      { code: 'te-IN', label: 'తెలుగు' },
      { code: 'kn-IN', label: 'ಕನ್ನಡ' },
      { code: 'ml-IN', label: 'മലയാളം' },
      { code: 'bn-IN', label: 'বাংলা' },
      { code: 'mr-IN', label: 'मराठी' },
      { code: 'gu-IN', label: 'ગુજરાતી' },
      { code: 'pa-IN', label: 'ਪੰਜਾਬੀ' },
    ];
    const device = navigator.language || 'en-IN';
    const sameBase = (a, b) => a.split('-')[0] === b.split('-')[0];
    let langCode =
      localStorage.getItem('gb.qa.lang') ||
      (LANGS.find((l) => l.code === device) || LANGS.find((l) => sameBase(l.code, device)) || {})
        .code ||
      device;
    if (!LANGS.some((l) => l.code === langCode)) {
      // Device speaks something we didn't list — offer it anyway, by name.
      let label = langCode;
      try {
        label = new Intl.DisplayNames([langCode], { type: 'language' }).of(langCode) || langCode;
      } catch (_) {
        /* keep the raw code */
      }
      LANGS.unshift({ code: langCode, label });
    }
    langBtn = h('select', {
      class: 'gb-input',
      style: { width: 'auto', flex: 'none', padding: '8px 10px' },
      'aria-label': 'Language you speak',
      title: 'Language you speak',
    });
    LANGS.forEach((l) => {
      const o = h('option', { value: l.code }, l.label);
      if (l.code === langCode) o.selected = true;
      langBtn.appendChild(o);
    });
    langBtn.addEventListener('change', () => {
      langCode = langBtn.value;
      localStorage.setItem('gb.qa.lang', langCode);
      saveUiPrefs({ qaLang: langCode });
    });
    micBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--compact gb-mic',
        'aria-label': 'Speak instead of typing',
      },
      Icon('mic', { size: 18 })
    );
    const gotSpeech = (said) => {
      if (said) qaInput.value = (qaInput.value ? qaInput.value + ' ' : '') + said;
      qaInput.focus();
    };

    if (capSR) {
      // Native path (mobile app): promise-based one-shot recognition.
      let listening = false;
      micBtn.addEventListener('click', async () => {
        if (listening) {
          try {
            await capSR.stop();
          } catch (_) {
            /* already stopped */
          }
          return;
        }
        try {
          const perm = await capSR.requestPermissions();
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') {
            pushToast('Microphone access was blocked — allow it in Settings.', 'error', 3600);
            return;
          }
          listening = true;
          micBtn.classList.add('is-listening');
          const res = await capSR.start({
            language: langCode,
            maxResults: 1,
            partialResults: false,
            popup: false,
          });
          const said = res && res.matches && res.matches[0] ? res.matches[0].trim() : '';
          if (said) gotSpeech(said);
          else pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
        } catch (_) {
          pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
        } finally {
          listening = false;
          micBtn.classList.remove('is-listening');
        }
      });
    } else {
      // Browser path: Web Speech API.
      let rec = null;
      langBtn.addEventListener('change', () => {
        if (rec) rec.stop();
      });
      micBtn.addEventListener('click', () => {
        if (rec) {
          rec.stop();
          return;
        }
        rec = new SR();
        rec.lang = langCode;
        rec.interimResults = false;
        micBtn.classList.add('is-listening');
        rec.onresult = (e) => {
          const said = Array.from(e.results)
            .map((r) => r[0].transcript)
            .join(' ')
            .trim();
          gotSpeech(said);
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed') {
            pushToast('Microphone access was blocked — allow it in your browser.', 'error', 3600);
          } else {
            pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
          }
        };
        rec.onend = () => {
          micBtn.classList.remove('is-listening');
          rec = null;
        };
        rec.start();
      });
    }
  }

  const quickAddBox = h(
    'div',
    { class: 'gb-quickadd' },
    h('div', { class: 'gb-quickadd-row' }, qaInput, micBtn, langBtn, qaBtn),
    h(
      'div',
      { class: 'gb-quickadd-hint' },
      micBtn
        ? 'Type or speak in your own language — I’ll file it into the right place.'
        : 'Type in your own language — I’ll file it into the right place.'
    )
  );

  const opts = [
    {
      key: 'task',
      icon: 'list-todo',
      label: 'Task',
      sub: 'A to-do for today',
      action: () => {
        close();
        openAddTask();
      },
    },
    {
      key: 'habit',
      icon: 'repeat',
      label: 'Habit',
      sub: 'Something to do every day',
      action: () => {
        close();
        openAddHabit();
      },
    },
    {
      key: 'reminder',
      icon: 'calendar-plus',
      label: 'Reminder',
      sub: 'Opens your calendar to pick a day',
      action: () => {
        close();
        calToday();
        setScreen('calendar');
      },
    },
    {
      key: 'sleep',
      icon: 'moon',
      label: 'Sleep',
      sub: 'Bedtime and wake time',
      action: () => {
        close();
        openSleepSchedule();
      },
    },
    {
      key: 'mood',
      icon: 'smile-plus',
      label: 'Mood',
      sub: 'Energy and stress check-in',
      action: () => {
        close();
        openMoodCheckin();
      },
    },
  ];
  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick add' },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'What would you like to add?'),
      h('div', { class: 'gb-modal-sub' }, 'Pick one, or type it in your own words.')
    ),
    // The explicit five come first. Quick add is an AI shortcut that needs a key
    // configured on the server — leading with it meant the most prominent path
    // was the one that could fail after you'd already typed a sentence.
    h(
      'div',
      { class: 'gb-modal-opts' },
      opts.map((o) =>
        h(
          'button',
          { type: 'button', class: 'gb-modal-opt', onclick: o.action },
          h('span', { class: 'gb-modal-opt-ic' }, Icon(o.icon, { size: 18 })),
          h(
            'span',
            { class: 'gb-modal-opt-tx' },
            h('span', { class: 'gb-modal-opt-l' }, o.label),
            h('span', { class: 'gb-modal-opt-s' }, o.sub)
          )
        )
      )
    ),
    h('div', { class: 'gb-quickadd-or' }, 'or describe it in one line'),
    quickAddBox,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

/* `<input type="datetime-local">` wants wall-clock local time, not the UTC an
   ISO string carries — toISOString() here would prefill the wrong hour. */
function toDateTimeLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

/* Title / priority / due — the same three fields whether you're adding a task
   or editing one, so both modals build the form from here. */
function taskForm(task) {
  const titleInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Finish the design review',
    maxlength: 255,
    value: (task && task.title) || '',
  });
  const priority = segmented(
    [
      { value: 'Low', label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' },
    ],
    (task && task.priority) || 'Medium'
  );
  const dueInput = h('input', {
    type: 'datetime-local',
    class: 'gb-input',
    value: task && task.dueAt ? toDateTimeLocal(task.dueAt) : '',
  });

  return {
    node: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Title'),
      titleInput,
      h('div', { class: 'gb-field-label' }, 'Priority'),
      priority.node,
      h('div', { class: 'gb-field-label' }, 'Due (optional)'),
      dueInput
    ),
    focus: () => setTimeout(() => titleInput.focus(), 60),
    read: () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        throw new Error('Title is required');
      }
      return {
        title,
        priority: priority.get(),
        dueAt: dueInput.value ? new Date(dueInput.value).toISOString() : null,
      };
    },
  };
}

function openAddTask() {
  const form = taskForm();
  openModal({
    title: 'New task',
    body: form.node,
    primary: 'Add task',
    onPrimary: () => createTask(form.read()),
  });
  form.focus();
}

function openEditTask(task) {
  const form = taskForm(task);
  openModal({
    title: 'Edit task',
    sub: task.title,
    body: form.node,
    primary: 'Save changes',
    // ponytail: a null dueAt means "leave it alone" to UpdateTaskRequest, so
    // you can move a due date but not remove one. Needs a backend flag to fix.
    onPrimary: () => updateTask(task.id, form.read()),
  });
  form.focus();
}

function colorPicker(initial) {
  // Friendly palette mapped to token-aware hexes (so dark mode still reads OK).
  const swatches = [
    { v: '#F97316', name: 'orange' },
    { v: '#22C55E', name: 'green' },
    { v: '#0EA5E9', name: 'sky' },
    { v: '#6C5CE7', name: 'iris' },
    { v: '#E11D48', name: 'coral' },
    { v: '#EAB308', name: 'sun' },
  ];
  let selected = initial || '';
  const wrap = h('div', { class: 'gb-color-pick', role: 'radiogroup', 'aria-label': 'Color' });
  const dots = {};
  swatches.forEach((s) => {
    const dot = h('button', {
      type: 'button',
      class: 'gb-color-dot' + (s.v === selected ? ' is-on' : ''),
      style: { background: s.v },
      'aria-label': s.name,
      'aria-checked': String(s.v === selected),
      onclick: () => {
        selected = selected === s.v ? '' : s.v;
        for (const k in dots) dots[k].classList.toggle('is-on', k === selected);
      },
    });
    dots[s.v] = dot;
    wrap.appendChild(dot);
  });
  return { node: wrap, get: () => selected };
}

function openAddHabit() {
  const nameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Meditate',
    maxlength: 120,
  });
  const domain = segmented(
    [
      { value: 'habit', label: 'General' },
      { value: 'fitness', label: 'Fitness' },
      { value: 'study', label: 'Study' },
      { value: 'journal', label: 'Journal' },
    ],
    'habit'
  );
  const cadence = segmented(
    [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
    ],
    'daily'
  );
  const color = colorPicker('');
  const reminderInput = h('input', { type: 'time', class: 'gb-input' });

  const body = h(
    'div',
    { class: 'gb-form' },
    h('div', { class: 'gb-field-label' }, 'Name'),
    nameInput,
    h('div', { class: 'gb-field-label' }, 'Category'),
    domain.node,
    h('div', { class: 'gb-field-label' }, 'Color (optional)'),
    color.node,
    h('div', { class: 'gb-field-label' }, 'Cadence'),
    cadence.node,
    h('div', { class: 'gb-field-label' }, 'Daily reminder (optional)'),
    reminderInput
  );

  openModal({
    title: 'New habit',
    body,
    primary: 'Add habit',
    onPrimary: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        throw new Error('Name is required');
      }
      const d = domain.get();
      const icon = (DOMAIN[d] && DOMAIN[d].icon) || 'repeat';
      await createHabit({
        name,
        domain: d,
        icon,
        cadence: cadence.get(),
        color: color.get() || null,
        reminderTime: reminderInput.value || null,
      });
    },
  });
  setTimeout(() => nameInput.focus(), 60);
}

/** "Just now" / "5 min ago" / "2 h ago" / "3 d ago". */
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return Math.round(diffSec / 60) + ' min ago';
  if (diffSec < 86400) return Math.round(diffSec / 3600) + ' h ago';
  if (diffSec < 604800) return Math.round(diffSec / 86400) + ' d ago';
  return new Date(iso).toLocaleDateString();
}

/* ---- Bell dropdown ---- */
function notificationDropdown() {
  if (!state.notifOpen) return null;
  const items = state.notifications.slice(0, 12);
  const card = h('div', { class: 'gb-notif-pop' });
  card.appendChild(
    h(
      'div',
      { class: 'gb-notif-head' },
      h('span', null, 'Notifications'),
      state.notifications.length
        ? h(
            'a',
            {
              role: 'button',
              tabindex: '0',
              class: 'gb-login-link',
              onclick: async () => {
                try {
                  await api('/api/notifications/read-all', { method: 'PATCH' });
                } catch (_) {}
                state.notifications = state.notifications.map((n) => ({
                  ...n,
                  readAt: n.readAt || new Date().toISOString(),
                }));
                repaintOverlays();
              },
            },
            'Mark all read'
          )
        : null
    )
  );
  if (!items.length) {
    card.appendChild(h('div', { class: 'gb-notif-empty' }, "You're all caught up."));
  } else {
    items.forEach((n) => {
      const isMentorshipReq = n.kind === 'mentorship_request' && !n.readAt;
      const row = h(
        'div',
        { class: 'gb-notif-row' + (n.readAt ? '' : ' is-unread') },
        h('div', { class: 'gb-notif-dot' }),
        h(
          'div',
          { class: 'gb-notif-body', ...activate(() => markNotificationRead(n.id)) },
          h('div', { class: 'gb-notif-title' }, n.title),
          n.body ? h('div', { class: 'gb-notif-sub' }, n.body) : null,
          h('div', { class: 'gb-notif-time' }, relativeTime(n.createdAt))
        ),
        isMentorshipReq
          ? h(
              'div',
              { class: 'gb-notif-actions' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--primary',
                  style: { width: 'auto', padding: '6px 12px', fontSize: '0.75rem' },
                  onclick: () => respondMentorshipRequest(n.relatedId, n.id, true),
                },
                'Accept'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--ghost',
                  style: { width: 'auto', padding: '6px 12px', fontSize: '0.75rem' },
                  onclick: () => respondMentorshipRequest(n.relatedId, n.id, false),
                },
                'Reject'
              )
            )
          : null
      );
      card.appendChild(row);
    });
  }
  return card;
}

/* render() rebuilds the whole tree, so a toast that's merely still on screen
   gets a brand-new node on every unrelated render. Two things follow: its
   entrance must not replay, and it must not be cut off either — several call
   sites do `toastSuccess(...); render();`, which replaces the node while the
   entrance is still playing.

   Both are solved by driving the animation off the toast's age rather than off
   node identity: past the entrance it's `is-settled` (no animation at all),
   during it a negative animation-delay resumes at the point it had reached.
   Rebuild it as often as you like — the motion looks continuous.

   Keep in step with gb-toast-in's duration in styles/premium.css. */
const TOAST_IN_MS = 260;
function toastStack() {
  if (!state.toasts.length) return null;
  const now = Date.now();
  const nodes = state.toasts.map((t) => {
    const age = now - (t.at || 0);
    const entering = age >= 0 && age < TOAST_IN_MS;
    return h(
      'div',
      {
        class: 'gb-toast is-' + (t.kind || 'error') + (entering ? '' : ' is-settled'),
        style: entering ? { animationDelay: '-' + age + 'ms' } : null,
      },
      h(
        'span',
        { class: 'gb-toast-icon', 'aria-hidden': 'true' },
        Icon((t.kind || 'error') === 'success' ? 'check-circle-2' : 'circle-alert', {
          size: 15,
          sw: 2.4,
        })
      ),
      h('span', { class: 'gb-toast-msg' }, t.message),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-toast-close',
          'aria-label': 'Dismiss message',
          onclick: () => dismissToast(t.id),
        },
        Icon('x', { size: 14 })
      )
    );
  });
  return h('div', { class: 'gb-toast-stack', role: 'status', 'aria-live': 'polite' }, nodes);
}

function confirmDelete(message, onYes) {
  openModal({
    // The question IS the heading — "Please confirm" told the user nothing.
    title: message,
    body: null,
    primary: 'Delete',
    onPrimary: async () => {
      await onYes();
      toastSuccess('Deleted.');
    },
  });
}

/* ---- Habits screen ---- */
function ScreenHabits() {
  if (!state.habits.length) {
    return h(
      'div',
      { class: 'gb-placeholder gb-rise' },
      h(
        'div',
        { class: 'chip' },
        Icon('repeat', { size: 30, sw: 2.2, color: 'var(--brand-soft-fg)' })
      ),
      h('h2', null, 'No habits yet'),
      h('p', null, 'Start small — pick one thing you’d like to do every day.'),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { marginTop: '14px', maxWidth: '280px' },
          onclick: openAddHabit,
        },
        Icon('plus', { size: 18, sw: 2.6, color: 'var(--fg-on-brand)' }),
        'Add a habit'
      )
    );
  }
  const rows = state.habits.map((habit) => {
    const fz = habitFreezeState(habit);
    const streak = effectiveStreak(habit);
    const frozenCount = fz && fz.frozen ? fz.frozen.length : 0;
    const subChildren = [
      h(
        'span',
        null,
        (habit.cadence || 'daily') + (streak ? ' · 🔥 ' + streak + '-day streak' : '')
      ),
    ];
    if (frozenCount > 0) {
      subChildren.push(
        h(
          'span',
          {
            class: 'gb-freeze-badge',
            title: frozenCount + ' day' + (frozenCount === 1 ? '' : 's') + ' protected by a freeze',
          },
          Icon('snowflake', { size: 12, sw: 2.4 }),
          String(frozenCount)
        )
      );
    }
    const mainRow = h(
      'div',
      { class: 'gb-row' },
      IconChip({ domain: habit.domain, icon: habit.icon }),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title' }, habit.name),
        h(
          'div',
          {
            class: 'sub',
            style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
          },
          ...subChildren
        )
      ),
      (habit.cadence || 'daily') === 'daily' && !habit.doneToday
        ? (function () {
            const resting = !!habit.protectedToday;
            const noTokens = !resting && freezeTokensLeft() <= 0;
            return h(
              'button',
              {
                type: 'button',
                class: 'gb-rem-del' + (resting ? ' is-active' : ''),
                disabled: noTokens,
                'aria-pressed': String(resting),
                'aria-label': resting ? 'Remove rest day' : 'Mark today a rest day',
                title: resting
                  ? 'Rest day — your streak holds today. Tap to undo.'
                  : noTokens
                    ? 'No freezes left this week'
                    : 'Mark today a rest day (spends a freeze)',
                onclick: () => toggleRestDay(habit.id, !resting),
              },
              Icon('snowflake', { size: 16, color: resting ? 'var(--brand)' : undefined })
            );
          })()
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-rem-del gb-rem-del--danger',
          'aria-label': 'Delete habit',
          onclick: () => confirmDelete('Delete this habit?', () => deleteHabit(habit.id)),
        },
        Icon('trash-2', { size: 16 })
      ),
      Check({ done: habit.doneToday, onToggle: () => toggleHabit(habit.id) })
    );
    if (!fz || !fz.pendingBreak) {
      return mainRow;
    }
    const canProtect = freezeTokensLeft() > 0;
    return h(
      'div',
      null,
      mainRow,
      h(
        'div',
        { class: 'gb-freeze-alert' },
        h(
          'div',
          { class: 'gb-freeze-alert__text' },
          Icon('snowflake', { size: 16, sw: 2.4, color: 'var(--brand)' }),
          h('span', null, 'Missed a day — your ' + fz.brokenFrom + '-day streak is at risk.')
        ),
        h(
          'div',
          { class: 'gb-freeze-alert__actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--primary',
              style: { width: 'auto', padding: '7px 12px' },
              disabled: !canProtect,
              title: canProtect ? 'Use a freeze to keep your streak' : 'No freezes left this week',
              onclick: () => protectStreak(habit.id),
            },
            Icon('snowflake', { size: 15, sw: 2.4, color: 'var(--fg-on-brand)' }),
            canProtect ? 'Protect streak' : 'No freezes left'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft',
              style: { width: 'auto', padding: '7px 12px' },
              onclick: () => declineStreakBreak(habit.id),
            },
            'Let it reset'
          )
        )
      )
    );
  });
  return h(
    'div',
    { class: 'gb-rise', style: { padding: '0 0 24px' } },
    h(
      'div',
      {
        style: {
          padding: '6px 20px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
      (function () {
        const left = freezeTokensLeft();
        return h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'h3',
            {
              style: {
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '1.125rem',
                margin: 0,
              },
            },
            'Your habits'
          ),
          h(
            'span',
            {
              class: 'gb-freeze-chip',
              'data-empty': left > 0 ? 'false' : 'true',
              title: 'Freezes protect a streak after a missed day. You get 1 free pass each week.',
            },
            Icon('snowflake', { size: 13, sw: 2.4 }),
            left + ' freeze' + (left === 1 ? '' : 's') + ' left this week'
          )
        );
      })(),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft',
          style: { width: 'auto', padding: '8px 14px' },
          onclick: openAddHabit,
        },
        Icon('plus', { size: 16, sw: 2.6 }),
        'Add'
      )
    ),
    h(
      'div',
      { style: { padding: '0 20px' } },
      h('div', { class: 'gb-card', style: { padding: '4px 0' } }, rows)
    ),
    // Guard on the card, not on the function: it returns null when there's no
    // fitness habit or no sleep logged, and an empty padded div is still a gap.
    (() => {
      const card = HabitSleepInsightCard({ habits: state.habits, wellness: state.wellness });
      return card ? h('div', { style: { padding: '0 20px', marginTop: '12px' } }, card) : null;
    })()
  );
}

/* ---- Feature toggles ----
   Users can turn whole features on/off. A feature is ON unless explicitly set
   to false (opt-out), so existing users default to everything enabled. */
const FEATURE_DEFS = [
  { key: 'report', label: 'Report', desc: 'Progress overview, reflection & milestones' },
  { key: 'habits', label: 'Habits', desc: 'Daily habits & streaks' },
  { key: 'food', label: 'Food & meals', desc: 'Log meals and calories' },
  { key: 'water', label: 'Water tracking', desc: 'Track daily water intake' },
  { key: 'goals', label: 'Goals', desc: 'Short, mid & long-term goals' },
  { key: 'money', label: 'Money Buddy', desc: 'Expenses, budgets & AI money coach' },
  { key: 'focus', label: 'Focus timer', desc: 'Pomodoro & ambient sounds' },
  { key: 'calendar', label: 'Calendar & reminders', desc: 'Plan ahead & get reminders' },
  { key: 'mentor', label: 'AI mentor', desc: 'Chat with your AI buddy' },
  { key: 'circle', label: 'Growth circle', desc: 'Connect with mentors' },
  { key: 'family', label: 'Family', desc: 'Family profiles & AI meal planner' },
];
// Screen id -> the feature that must be ON to view it (home is always on).
const SCREEN_FEATURE = {
  report: 'report',
  focus: 'focus',
  habits: 'habits',
  goals: 'goals',
  money: 'money',
  calendar: 'calendar',
  mentor: 'mentor',
  circle: 'circle',
  family: 'family',
};
function featureOn(key) {
  const f = state.user && state.user.features;
  return !f || f[key] !== false;
}
function screenEnabled(screen) {
  if (screen === 'food') return featureOn('food') || featureOn('water');
  const feat = SCREEN_FEATURE[screen];
  return !feat || featureOn(feat);
}
/** Persist a single feature toggle, update local state, and repaint. */
async function setFeature(key, value) {
  const updated = await api('/api/auth/features', {
    method: 'PUT',
    body: JSON.stringify({ features: { [key]: value } }),
  });
  const token = (state.user && state.user.token) || loadToken();
  state.user = Object.assign({}, state.user, updated, { token });
  saveSession(state.user, token);
  render();
}

/** Persist progress-digest preferences (frequency + send hour) to the account. */
async function saveDigestPrefs(frequency, hour) {
  const updated = await api('/api/auth/digest', {
    method: 'PUT',
    body: JSON.stringify({ frequency, hour }),
  });
  const token = (state.user && state.user.token) || loadToken();
  state.user = Object.assign({}, state.user, updated, { token });
  saveSession(state.user, token);
  render();
}

/** Persist the ordered home-screen layout (which widgets show, in order). */
async function saveHomeLayout(layout) {
  // Optimistic local update so Home + the editor stay in sync immediately.
  state.user = Object.assign({}, state.user, { homeLayout: layout });
  saveSession(state.user, loadToken());
  render();
  try {
    const updated = await api('/api/auth/home-layout', {
      method: 'PUT',
      body: JSON.stringify({ layout }),
    });
    const token = (state.user && state.user.token) || loadToken();
    state.user = Object.assign({}, state.user, updated, { token });
    saveSession(state.user, token);
  } catch (err) {
    toastError(err, 'Could not save your home layout.');
  }
}

/** Persist the ordered bottom-nav layout (bar vs More + order). */
async function saveNavLayout(layout) {
  // Optimistic local update so the bar + editor stay in sync immediately.
  state.user = Object.assign({}, state.user, { navLayout: layout });
  saveSession(state.user, loadToken());
  render();
  try {
    const updated = await api('/api/auth/nav-layout', {
      method: 'PUT',
      body: JSON.stringify({ layout }),
    });
    const token = (state.user && state.user.token) || loadToken();
    state.user = Object.assign({}, state.user, updated, { token });
    saveSession(state.user, token);
  } catch (err) {
    toastError(err, 'Could not save your navigation layout.');
  }
}

const SCREENS = {
  home: {
    headerLabel: () => todayLabel(),
    // The wave is its own element so premium can drop it — the live seedling
    // beside the greeting already does that job, and two mascots is one too many.
    headerName: () =>
      h(
        'span',
        null,
        greetingFor(new Date().getHours()) + ', ' + firstName() + ' ',
        h('span', { class: 'gb-greet-wave' }, '👋')
      ),
    render: () =>
      ScreenDashboard({
        features: (state.user && state.user.features) || null,
        tasks: state.tasks,
        toggleTask,
        reminders: state.reminders,
        habits: state.habits,
        toggleHabit,
        score: score(),
        water: state.water,
        food: state.food,
        goals: state.goals,
        wellness: state.wellness,
        foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
        dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
        dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
        onAddTask: openAddTask,
        onEditTask: openEditTask,
        onAddHabit: openAddHabit,
        calYear: state.calYear,
        calMonth: state.calMonth,
        selectedDate: state.selectedDate,
        onSelectDate: selectDate,
        onPrevMonth: calPrevMonth,
        onNextMonth: calNextMonth,
        onRetryFood: retryCalendarFoodDate,
        onPlanToday: openDailyPlan,
        onAddSleep: openSleepSchedule,
        onAddMood: openMoodCheckin,
        onOnboardDismiss: () => saveUiPrefs({ onboardingDone: true }),
        onAddSuggestedReminder: addSuggestedReminder,
        money: state.money,
        onSaveMoney: saveMoney,
        onOpenMoney: () => setScreen('money'),
        homeLayout: (state.user && state.user.homeLayout) || null,
      }),
  },
  report: {
    headerLabel: () => 'Your progress',
    headerName: () => 'Progress',
    render: () =>
      lazyScreen(
        () => import('./report.js'),
        (m) =>
          m.ScreenReport({
            features: (state.user && state.user.features) || null,
            score: score(),
            tasks: state.tasks,
            habits: state.habits,
            goals: state.goals,
            water: state.water,
            food: state.food,
            wellness: state.wellness,
            trends: state.trends,
            money: state.money,
            range: state.reportRange,
            onRange: (days) => {
              state.reportRange = days;
              render();
            },
            onEnableFeature: (key) => {
              setFeature(key, true).catch((err) => toastError(err, 'Could not turn on feature.'));
            },
          })
      ),
  },
  achievements: {
    headerLabel: () => 'Your badges',
    headerName: () => 'Achievements',
    render: () => ScreenAchievements(achievementProps()),
  },
  focus: {
    headerLabel: () => 'Deep work',
    headerName: () => 'Timer',
    render: () =>
      lazyScreen(
        () => import('./timer.js'),
        (m) =>
          m.ScreenFocus({
            onFocusSession: (mode, durationSec) =>
              api('/api/focus/sessions', {
                method: 'POST',
                body: JSON.stringify({ mode, durationSec }),
              }),
            getFocusStats: () => api('/api/focus/stats'),
          })
      ),
  },
  habits: {
    headerLabel: () => 'Build your streaks',
    headerName: () => 'Habits',
    render: () => ScreenHabits(),
  },
  food: {
    headerLabel: () => 'Water & meals',
    headerName: () => 'Food',
    render: () =>
      ScreenFood({
        features: (state.user && state.user.features) || null,
        water: state.water,
        food: state.food,
        photoHistory: state.wellness.photoHistory || [],
        onQuickAddWater: quickAddWater,
        onUpdateWaterGoal: updateWaterGoal,
        onAddFood: openAddFood,
        onDeleteWater: deleteWaterEntry,
        onDeleteFood: deleteFoodEntry,
      }),
  },
  calendar: {
    headerLabel: () => 'Plan & remember',
    headerName: () => 'Calendar',
    render: () =>
      ScreenCalendar({
        year: state.calYear,
        month: state.calMonth,
        selectedDate: state.selectedDate,
        reminders: state.reminders,
        tasks: state.tasks,
        goals: state.goals,
        wellness: state.wellness,
        foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
        dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
        dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
        whatsappEnabled: !!(state.user && state.user.whatsappEnabled),
        onPrevMonth: calPrevMonth,
        onNextMonth: calNextMonth,
        onToday: calToday,
        onSelectDate: selectDate,
        onRetryFood: retryCalendarFoodDate,
        onAddReminder: addReminder,
        onDeleteReminder: deleteReminder,
      }),
  },
  mentor: {
    headerLabel: () => 'Your AI mentor',
    headerName: () => 'Buddy',
    render: () =>
      lazyScreen(
        () => import('./mentor.js'),
        (m) =>
          m.ScreenMentor({
            api: {
              get: () => api('/api/mentor/chat'),
              post: (text) =>
                api('/api/mentor/chat/messages', {
                  method: 'POST',
                  body: JSON.stringify({ content: text }),
                }),
              clear: () => api('/api/mentor/chat/messages', { method: 'DELETE' }),
            },
          })
      ),
  },
  circle: {
    headerLabel: () => 'Grow together',
    headerName: () => 'Growth Circle',
    render: () =>
      lazyScreen(
        () => import('./circle.js'),
        (m) =>
          m.ScreenCircle({
            onSearch: (q) => api('/api/users/search?q=' + encodeURIComponent(q)),
            onBrowse: () => api('/api/users/browse'),
            onSendInvite: (toUserId, direction, note) =>
              api('/api/mentorship/requests', {
                method: 'POST',
                body: JSON.stringify({ toUserId, direction, note }),
              }),
            onLoadOutgoing: () => api('/api/mentorship/requests/outgoing'),
            onLoadIncoming: () => api('/api/mentorship/requests/incoming'),
            onLoadStatus: (partnerId) =>
              api('/api/mentorship/connections/' + encodeURIComponent(partnerId) + '/status'),
            onRevoke: (requestId) =>
              api('/api/mentorship/requests/' + encodeURIComponent(requestId) + '/revoke', {
                method: 'POST',
              }),
            currentUserId: state.user && state.user.id,
            challengesApi: {
              listMine: () => api('/api/circles/mine'),
              listAll: () => api('/api/circles'),
              createCircle: (body) =>
                api('/api/circles', { method: 'POST', body: JSON.stringify(body) }),
              join: (id) =>
                api('/api/circles/' + encodeURIComponent(id) + '/join', { method: 'POST' }),
              listChallenges: (id) => api('/api/circles/' + encodeURIComponent(id) + '/challenges'),
              createChallenge: (id, body) =>
                api('/api/circles/' + encodeURIComponent(id) + '/challenges', {
                  method: 'POST',
                  body: JSON.stringify(body),
                }),
            },
          })
      ),
  },
  family: {
    headerLabel: () => 'Cook for everyone',
    headerName: () => 'Family',
    render: () =>
      lazyScreen(
        () => import('./family.js'),
        (m) =>
          m.ScreenFamily({
            api: {
              getFamily: () => api('/api/family'),
              addMember: (body) =>
                api('/api/family/members', { method: 'POST', body: JSON.stringify(body) }),
              updateMember: (id, body) =>
                api('/api/family/members/' + encodeURIComponent(id), {
                  method: 'PUT',
                  body: JSON.stringify(body),
                }),
              updateProfile: (id, profile) =>
                api('/api/family/members/' + encodeURIComponent(id) + '/profile', {
                  method: 'PUT',
                  body: JSON.stringify(profile),
                }),
              removeMember: (id) =>
                api('/api/family/members/' + encodeURIComponent(id), { method: 'DELETE' }),
              leaveFamily: () => api('/api/family/leave', { method: 'POST' }),
              searchUsers: (q) => api('/api/family/search?q=' + encodeURIComponent(q)),
              linkMember: (body) =>
                api('/api/family/members/link', { method: 'POST', body: JSON.stringify(body) }),
              getInvites: () => api('/api/family/invites'),
              acceptInvite: (memberId) =>
                api('/api/family/invites/' + encodeURIComponent(memberId) + '/accept', {
                  method: 'POST',
                }),
              declineInvite: (memberId) =>
                api('/api/family/invites/' + encodeURIComponent(memberId) + '/decline', {
                  method: 'POST',
                }),
              scanGrocery: (imageDataUrl) =>
                api('/api/family/grocery-scan', {
                  method: 'POST',
                  body: JSON.stringify({ imageDataUrl }),
                }),
              generateMealPlan: (body) =>
                api('/api/family/meal-plan', { method: 'POST', body: JSON.stringify(body) }),
              getMealPlan: () => api('/api/family/meal-plan'),
              markCooked: (planId) =>
                api('/api/family/meal-plan/' + encodeURIComponent(planId) + '/cooked', {
                  method: 'POST',
                }),
              // Favourites
              listFavourites: () => api('/api/family/favourites'),
              saveFavourite: (body) =>
                api('/api/family/favourites', { method: 'POST', body: JSON.stringify(body) }),
              deleteFavourite: (id) =>
                api('/api/family/favourites/' + encodeURIComponent(id), { method: 'DELETE' }),
              // Weekly / monthly + occasions
              generateWeekly: (body) =>
                api('/api/family/meal-plan/multi', { method: 'POST', body: JSON.stringify(body) }),
              getWeekly: () => api('/api/family/meal-plan/multi'),
              // Pantry
              listPantry: () => api('/api/family/pantry'),
              addPantry: (body) =>
                api('/api/family/pantry', { method: 'POST', body: JSON.stringify(body) }),
              scanPantry: (imageDataUrl) =>
                api('/api/family/pantry/scan', {
                  method: 'POST',
                  body: JSON.stringify({ imageDataUrl }),
                }),
              deletePantry: (id) =>
                api('/api/family/pantry/' + encodeURIComponent(id), { method: 'DELETE' }),
              // Shopping list
              listShopping: () => api('/api/family/shopping'),
              addShopping: (body) =>
                api('/api/family/shopping', { method: 'POST', body: JSON.stringify(body) }),
              generateShopping: (body) =>
                api('/api/family/shopping/generate', {
                  method: 'POST',
                  body: JSON.stringify(body || {}),
                }),
              toggleShopping: (id) =>
                api('/api/family/shopping/' + encodeURIComponent(id) + '/toggle', {
                  method: 'POST',
                }),
              deleteShopping: (id) =>
                api('/api/family/shopping/' + encodeURIComponent(id), { method: 'DELETE' }),
            },
          })
      ),
  },
  money: {
    headerLabel: () => 'Spend & save well',
    headerName: () => 'Money Buddy',
    render: () =>
      ScreenMoney({
        money: state.money,
        onSaveMoney: saveMoney,
        requestAdvice: (payload) =>
          api('/api/money/advice', { method: 'POST', body: JSON.stringify(payload) }),
      }),
  },
  goals: {
    headerLabel: () => 'Track progress',
    headerName: () => 'Goals',
    render: () =>
      lazyScreen(
        () => import('./goals.js'),
        (m) =>
          m.ScreenGoals({
            sections: state.goals,
            onCreateGoal: createGoal,
            onToggleGoal: toggleGoal,
            onDeleteGoal: deleteGoal,
            onAddAction: addGoalAction,
            onUpdateAction: updateGoalAction,
            onDeleteAction: deleteGoalAction,
            goalProgress: state.goalProgress || {},
            onUpdateGoalProgress: updateGoalProgress,
          })
      ),
  },
};

/* ---- Render ---- */
const root = document.getElementById('root');
let renderedScreen = '';

/* ---- Lazy screens ----
   Six screens export nothing but their own `Screen*` to app.js and nothing else
   imports them, so they don't belong in the boot chunk: family, circle, timer,
   goals, report and mentor are ~151 KB of source that a user landing on Home
   never touches. (money.js can't join them yet — Home's Money card and
   `normalizeMoney` pull it in eagerly; see the note in docs.)

   `SCREENS[x].render()` has to stay synchronous because render() uses its return
   value as a child directly. So return a placeholder now and `replaceWith` the
   real root when the chunk lands — replace, not append, because the real root
   must end up a direct child of `.gb-scroll`: the desktop width cap is
   `.gb-scroll > .gb-rise:not(.gb-goals):not(.gb-mentor)`, and wrapping it in a
   container would both steal the cap and break those two exceptions.
   Modules cache after first import, so this costs one round trip per session. */
function screenSkeleton() {
  const bar = (w) => h('div', { class: 'gb-skel-line', style: { width: w } });
  const card = () =>
    h(
      'div',
      { class: 'gb-card gb-skel-card' },
      h('div', { class: 'gb-skel-avatar' }),
      h('div', { class: 'gb-skel-lines' }, bar('60%'), bar('40%'))
    );
  return h('div', { class: 'gb-rise gb-lazy-skeleton' }, card(), card(), card());
}

function lazyScreen(loader, build) {
  const placeholder = screenSkeleton();
  loader()
    .then((mod) => {
      // A later render() may have swapped this placeholder out already; that
      // render made its own, so this one is stale and must not resurrect itself.
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(build(mod));
      refreshIcons();
    })
    .catch((err) => {
      console.error('Screen failed to load', err);
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(CrashCard(() => render()));
      refreshIcons();
    });
  return placeholder;
}

function bottomNav() {
  return BottomNav({
    active: state.screen,
    onNav: setScreen,
    onMore: toggleMoreOpen,
    moreOpen: state.moreOpen,
    features: (state.user && state.user.features) || null,
    layout: (state.user && state.user.navLayout) || null,
  });
}

/* Repaint only the header popovers and the nav — never the screen.
   These three are siblings of the active screen, so opening the bell or the
   account menu has no business rebuilding it. `render()` calls `cfg.render()`,
   which constructs a brand-new screen and discards whatever state that screen
   owned internally: on Family, tapping the bell while the Pantry tab was open
   dumped you back on Members. Same for Money, Mentor and Circle, which also
   manage their own subtrees (see docs/scripts/app.js.md).
   Falls back to a full render before first paint, when the slots don't exist. */
function repaintOverlays() {
  const notif = document.getElementById('gb-notif-slot');
  const profile = document.getElementById('gb-profile-slot');
  const nav = document.querySelector('.gb-nav-wrap');
  if (!notif || !profile || !nav) {
    render();
    return;
  }
  notif.replaceChildren(...[notificationDropdown()].filter(Boolean));
  profile.replaceChildren(...[profileDropdown()].filter(Boolean));
  nav.replaceWith(bottomNav());
  paintBellBadge();
  refreshIcons();
  installOutsideClickToCloseHeaderPopovers();
}

/* The unread count on the bell. Lives here rather than in a full render()
   because reading a notification changes nothing else on the page — and a
   render() rebuilds the active screen from scratch, so Family/Circle visibly
   reloaded (skeletons and all) every time you tapped "Mark all read". */
function paintBellBadge() {
  const bell = document.querySelector('.gb-bell');
  if (!bell) return;
  const n = unreadNotifs();
  const badge = bell.querySelector('.gb-bell-badge');
  if (!n) {
    if (badge) badge.remove();
    return;
  }
  const text = n > 99 ? '99+' : String(n);
  if (badge) badge.textContent = text;
  else bell.appendChild(h('span', { class: 'gb-bell-badge' }, text));
}

function captureScrollPosition() {
  const scroll = document.querySelector('.gb-scroll');
  if (!scroll) return null;
  return {
    screen: renderedScreen,
    top: scroll.scrollTop,
    left: scroll.scrollLeft,
  };
}

function restoreScrollPosition(snapshot) {
  if (!snapshot || snapshot.screen !== state.screen) return;
  const scroll = document.querySelector('.gb-scroll');
  if (!scroll) return;
  const apply = () => {
    const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollTop = Math.min(snapshot.top, maxTop);
    scroll.scrollLeft = snapshot.left;
  };
  apply();
  requestAnimationFrame(apply);
}

/* ---- Auth: low-level POST that surfaces backend status + json body ---- */
async function authPost(path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) {
    throw new Error('Cannot reach the server. Make sure Growth Buddy is running, then try again.');
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    /* 204s */
  }
  if (!res.ok) {
    const msg = (payload && payload.message) || statusMessage(res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return payload;
}

// The verify step (post-signup) is the only auth screen worth surviving a
// reload — the others are re-enterable from scratch. sessionStorage clears
// when the tab closes, which is the right lifetime for a pending OTP.
function loadAuthDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem('gb.authDraft') || 'null');
    return d && d.mode === 'verify' ? d : {};
  } catch (_) {
    return {};
  }
}

function setAuthMode(mode, opts) {
  opts = opts || {};
  state.authMode = mode;
  state.error = '';
  state.errorField = '';
  state.authNotice = opts.notice || '';
  if (opts.email !== undefined) state.authEmail = opts.email;
  try {
    if (mode === 'verify') {
      sessionStorage.setItem('gb.authDraft', JSON.stringify({ mode, email: state.authEmail }));
    } else {
      sessionStorage.removeItem('gb.authDraft');
    }
  } catch (_) {
    /* sessionStorage unavailable (private mode) — verify still works in-memory */
  }
  render();
}

function authLink(label, onClick) {
  return h(
    'a',
    {
      role: 'button',
      tabindex: '0',
      class: 'gb-login-link',
      onclick: onClick,
      onkeydown: (e) => {
        if (e.key === 'Enter') onClick();
      },
    },
    label
  );
}

function authShell(title, subtitle, children) {
  return h(
    'div',
    { class: 'gb-login-wrap' },
    h(
      'div',
      { class: 'gb-login-card gb-rise' },
      h(
        'div',
        { class: 'gb-login-brand' },
        Icon('sprout', { size: 28, color: 'var(--brand)' }),
        h('span', null, 'Growth Buddy')
      ),
      h('h1', { class: 'gb-login-title' }, title),
      subtitle ? h('p', { class: 'gb-login-sub' }, subtitle) : null,
      state.authNotice ? h('p', { class: 'gb-login-notice' }, state.authNotice) : null,
      children,
      state.error && !state.errorField ? h('p', { class: 'gb-login-error' }, state.error) : null
    )
  );
}

function primaryBtn(label, onClick) {
  return h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary gb-login-btn' + (state.loading ? ' is-loading' : ''),
      onclick: onClick,
      disabled: state.loading ? true : null,
      'aria-busy': state.loading ? 'true' : null,
    },
    state.loading ? h('span', { class: 'gb-spinner', 'aria-hidden': 'true' }) : null,
    state.loading ? 'Please wait…' : label
  );
}

/* `key` ties this input to state.errorField, so the message lands under the
   field that's actually wrong instead of at the bottom of the card. */
function field(label, node, key) {
  // `node` is the input itself, or a wrapper around it (the OTP boxes).
  const input = node.tagName === 'INPUT' ? node : node.querySelector('input');
  const bad = !!key && state.errorField === key && !!state.error;
  if (bad) input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', bad ? 'true' : 'false');
  return [
    h('label', { class: 'gb-login-label' }, label),
    node,
    bad ? h('p', { class: 'gb-login-fielderr' }, state.error) : null,
  ];
}

/* A password you can't read is a password you mistype — and retyping it into a
   confirm field doesn't tell you which of the two was wrong. Every hidden
   field gets a reveal. */
function passwordField(input) {
  // Revealed-ness lives on the input's own type, not in a closure flag, so a
  // re-render that restores the type (renderAuth) restores the eye with it.
  const paint = () => {
    const hidden = String(input.type === 'password');
    if (toggle.dataset.hidden === hidden) return; // cheap: this also runs per keystroke
    toggle.dataset.hidden = hidden;
    toggle.setAttribute('aria-label', hidden === 'true' ? 'Show password' : 'Hide password');
    toggle.replaceChildren(Icon(hidden === 'true' ? 'eye' : 'eye-off', { size: 18 }));
  };
  const toggle = h('button', {
    type: 'button',
    class: 'gb-pw-toggle',
    tabindex: '-1', // the field, not its decoration, is what Tab should reach
    onclick: () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      paint();
      input.focus();
      // Caret to the end: focus() alone would select the whole value, and the
      // next keystroke would wipe the password the user is checking.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    },
  });
  paint();
  // renderAuth restores the type after this node is built, and says so with an
  // input event — without this the eye would disagree with the field.
  input.addEventListener('input', paint);
  return h('div', { class: 'gb-pw' }, input, toggle);
}

/* Six boxes, one real input. Six real inputs would mean hand-rolling focus
   hops, paste-splitting, backspace-into-the-previous-box and the numeric
   keyboard — the browser already does all of that for one field, so the field
   stays and only goes transparent, stretched across the row. The boxes are
   painted from its value. autocomplete=one-time-code still fills it. */
function otpBoxes(input, busy) {
  input.classList.add('gb-otp-field');
  const boxes = Array.from({ length: 6 }, (_, i) =>
    h('div', { class: 'gb-otp-box', style: { '--i': String(i) } })
  );
  const wrap = h(
    'div',
    { class: 'gb-otp' + (busy ? ' is-busy' : '') },
    input,
    h('div', { class: 'gb-otp-boxes' }, boxes)
  );
  function paint() {
    const digits = (input.value || '').replace(/\D/g, '').slice(0, 6);
    if (digits !== input.value) input.value = digits;
    const caret = document.activeElement === input ? Math.min(digits.length, 5) : -1;
    boxes.forEach((box, i) => {
      box.textContent = digits[i] || '';
      box.classList.toggle('is-filled', !!digits[i]);
      box.classList.toggle('is-active', i === caret);
    });
  }
  // 'keyup' catches arrow keys and backspace-at-the-end, which fire no 'input'.
  ['input', 'keyup', 'focus', 'blur', 'click'].forEach((e) => input.addEventListener(e, paint));
  paint();
  return wrap;
}

/* render() builds the auth inputs from scratch, so anything typed into them is
   gone the moment we re-render to show an error — you fail on the password and
   lose the email you just typed. Carry the values across by position: a refusal
   or a spinner never changes which view is on screen. */
function renderAuth() {
  const before = Array.from(document.querySelectorAll('.gb-login-input'), (i) => ({
    value: i.value,
    type: i.type,
  }));
  render();
  document.querySelectorAll('.gb-login-input').forEach((input, i) => {
    const was = before[i];
    if (!was) return;
    // A revealed password stays revealed across the render that shows the error.
    if (was.type === 'text' && input.type === 'password') input.type = 'text';
    if (was.value) input.value = was.value;
    // Anything painted from the input — OTP boxes, the reveal eye — repaints off this.
    input.dispatchEvent(new Event('input'));
  });
}

/* One refusal path for every auth screen: mark the field, say why under it,
   shake it, focus it. The nodes are looked up after the render — the ones the
   view closed over are detached by then. */
function authFail(message, key) {
  state.error = message;
  state.errorField = key || '';
  renderAuth();
  refuseFocus();
}

/* Shake whatever just said no — the offending field, or the card when the
   failure belongs to no field — and put the cursor in it with the bad value
   selected, so retyping replaces instead of appending. */
function refuseFocus() {
  const bad = document.querySelector('.gb-login-input.is-invalid');
  if (bad) {
    bad.focus();
    // Select so retyping replaces — except a code, where the digits already
    // entered are still the ones the user wants to keep typing after.
    if (bad.value && !bad.classList.contains('gb-otp-field')) bad.select();
  }
  // The OTP field itself is transparent — shake the boxes the user can see.
  const surface = bad && (bad.closest('.gb-otp') || bad);
  shakeRefusal(surface || document.querySelector('.gb-login-card'));
}

/* Face ID doesn't just print "incorrect" — it shakes its head at you.
   This is that gesture, and it belongs to the whole interface rather than to
   one screen: whatever surface just refused the user is what shakes. Wrong
   password shakes the sign-in card; a modal that rejects what you typed
   shakes the modal. One refusal, one gesture, so it reads as the product's
   own body language instead of a trick on the login page.

   Keyframes live in styles/app.css; under reduced-motion the global kill
   switch drops the movement and the red field ring carries the meaning. */
function shakeRefusal(el) {
  if (!el) return;
  el.classList.remove('gb-shake');
  void el.offsetWidth; // restart the animation when the same surface fails twice
  el.classList.add('gb-shake');
  el.addEventListener('animationend', () => el.classList.remove('gb-shake'), { once: true });
  try {
    if (navigator.vibrate) navigator.vibrate([14, 70, 14]);
  } catch (_) {}
}

/* `errField` names the input a server refusal belongs under ('password' for a
   bad sign-in, 'otp' for a bad code). Without one the failure is nobody's
   field — a dropped connection, say — and stays a toast. */
function runAuth(action, errField) {
  state.loading = true;
  state.error = '';
  state.errorField = '';
  renderAuth();
  let rejected = false;
  return action()
    .catch((err) => {
      rejected = true;
      const message = (err && err.message) || 'Something went wrong.';
      if (errField) {
        state.error = message;
        state.errorField = errField;
      } else {
        toastError(err, 'Something went wrong.');
      }
    })
    .finally(() => {
      state.loading = false;
      renderAuth();
      if (rejected) refuseFocus();
    });
}

/* ---- Sign-in ---- */
function viewSignin() {
  const emailInput = h('input', {
    type: 'email',
    class: 'gb-input gb-login-input',
    placeholder: 'you@example.com',
    required: true,
    value: state.authEmail || '',
  });
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: '••••••••',
    maxlength: 128,
    autocomplete: 'current-password',
  });
  const pwField = passwordField(pwInput);

  function submit() {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    // Silent returns made the button feel dead — always say what's missing.
    if (!email) return authFail('Enter your email to sign in.', 'email');
    if (!password) return authFail('Enter your password to sign in.', 'password');
    runAuth(async () => {
      // Sign-in is a plain credential check: it never routes to the OTP/verify
      // screen and never sends email. Any failure (wrong credentials, or an
      // unverified account) surfaces as an error toast via runAuth.
      const user = await authPost('/api/auth/login', { email, password });
      syncUserSession(user);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    }, 'password');
  }

  [emailInput, pwInput].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    })
  );

  return authShell('Welcome back', 'Sign in to sync your habits, tasks, reminders, and score.', [
    ...field('Email', emailInput, 'email'),
    ...field('Password', pwField, 'password'),
    primaryBtn('Sign in', submit),
    h(
      'div',
      { class: 'gb-login-row' },
      authLink('Forgot password?', () => setAuthMode('forgot', { email: emailInput.value.trim() })),
      authLink('Create account', () => setAuthMode('signup', { email: emailInput.value.trim() }))
    ),
  ]);
}

/* ---- Sign-up ---- */
function viewSignup() {
  const emailInput = h('input', {
    type: 'email',
    class: 'gb-input gb-login-input',
    placeholder: 'you@example.com',
    required: true,
    value: state.authEmail || '',
  });
  const nameInput = h('input', {
    type: 'text',
    class: 'gb-input gb-login-input',
    placeholder: 'Your name',
    maxlength: 120,
  });
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'At least 8 characters',
    maxlength: 128,
    autocomplete: 'new-password',
  });
  const pwField = passwordField(pwInput);
  const pw2Input = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'Type it again',
    maxlength: 128,
    autocomplete: 'new-password',
  });
  const pw2Field = passwordField(pw2Input);

  function submit() {
    const email = emailInput.value.trim();
    const displayName = nameInput.value.trim();
    const password = pwInput.value;
    if (!email) return authFail('Enter your email to create the account.', 'email');
    if (password.length < 8) return authFail('Password must be at least 8 characters.', 'password');
    if (pw2Input.value !== password) return authFail('The two passwords don’t match.', 'confirm');
    runAuth(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await authPost('/api/auth/signup', { email, password, displayName, timezone: tz });
      setAuthMode('verify', {
        email,
        notice: 'We sent a 6-digit code to ' + email + '. Enter it below to finish signing up.',
      });
    }, 'email');
  }

  [emailInput, nameInput, pwInput, pw2Input].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    })
  );

  // No subtitle: the next screen is the code screen and explains itself there.
  return authShell('Create your account', '', [
      ...field('Email', emailInput, 'email'),
      ...field('Name', nameInput, 'name'),
      ...field('Password', pwField, 'password'),
      ...field('Confirm password', pw2Field, 'confirm'),
      primaryBtn('Create account', submit),
      h(
        'div',
        { class: 'gb-login-row' },
        authLink('Have an account? Sign in', () =>
          setAuthMode('signin', { email: emailInput.value.trim() })
        )
      ),
    ]
  );
}

/* ---- Verify (OTP entered after signup or after blocked login) ---- */
function viewVerify() {
  const otpInput = h('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '\\d{6}',
    class: 'gb-input gb-login-input',
    maxlength: 6,
    autocomplete: 'one-time-code',
  });
  const otpField = otpBoxes(otpInput, state.loading);
  function submit() {
    const otp = (otpInput.value || '').replace(/\D/g, '');
    if (otp.length !== 6) return authFail('Enter the 6-digit code (must be exactly 6 digits).', 'otp');
    runAuth(async () => {
      const user = await authPost('/api/auth/verify', { email: state.authEmail, otp });
      syncUserSession(user);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    }, 'otp');
  }
  function resend() {
    runAuth(async () => {
      await authPost('/api/auth/resend-verification', { email: state.authEmail });
      state.authNotice =
        'New code sent to ' + state.authEmail + '. Check your inbox (and spam folder).';
      otpInput.value = '';
    });
  }
  otpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  setTimeout(() => otpInput.focus(), 60);

  return authShell(
    'Verify your email',
    'Code sent to ' +
      state.authEmail +
      '. Check your inbox (and spam folder) for the 6-digit code.',
    [
      ...field('6-digit code', otpField, 'otp'),
      primaryBtn('Verify & continue', submit),
      h(
        'div',
        { class: 'gb-login-row' },
        authLink('Resend code', resend),
        authLink('Use a different email', () => setAuthMode('signup', { email: state.authEmail }))
      ),
    ]
  );
}

/* ---- Forgot password (request a reset code) ---- */
function viewForgot() {
  const emailInput = h('input', {
    type: 'email',
    class: 'gb-input gb-login-input',
    placeholder: 'you@example.com',
    value: state.authEmail || '',
  });
  function submit() {
    const email = emailInput.value.trim();
    if (!email) return authFail('Enter your email and we’ll send the code there.', 'email');
    runAuth(async () => {
      await authPost('/api/auth/forgot-password', { email });
      setAuthMode('reset', {
        email,
        notice: 'If that email is registered, we just sent a 6-digit code to it.',
      });
    }, 'email');
  }
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  return authShell('Forgot password', 'Enter your email and we’ll send you a code.', [
    ...field('Email', emailInput, 'email'),
    primaryBtn('Send code', submit),
    h(
      'div',
      { class: 'gb-login-row' },
      authLink('Back to sign in', () => setAuthMode('signin', { email: emailInput.value.trim() }))
    ),
  ]);
}

/* ---- Reset password (enter code + new password) ---- */
function viewReset() {
  const otpInput = h('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '\\d{6}',
    class: 'gb-input gb-login-input',
    maxlength: 6,
    autocomplete: 'one-time-code',
  });
  const otpField = otpBoxes(otpInput, state.loading);
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'At least 8 characters',
    maxlength: 128,
    autocomplete: 'new-password',
  });
  const pwField = passwordField(pwInput);
  const pw2Input = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'Type it again',
    maxlength: 128,
    autocomplete: 'new-password',
  });
  const pw2Field = passwordField(pw2Input);
  function submit() {
    const otp = (otpInput.value || '').replace(/\D/g, '');
    if (otp.length !== 6) return authFail('Enter the 6-digit code.', 'otp');
    if (pwInput.value.length < 8) return authFail('Password must be at least 8 characters.', 'password');
    if (pw2Input.value !== pwInput.value) return authFail('The two passwords don’t match.', 'confirm');
    runAuth(async () => {
      const user = await authPost('/api/auth/reset-password', {
        email: state.authEmail,
        otp,
        password: pwInput.value,
      });
      syncUserSession(user);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    }, 'otp');
  }
  [otpInput, pwInput, pw2Input].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    })
  );

  return authShell('Set a new password', 'Code sent to ' + state.authEmail + '.', [
    ...field('6-digit code', otpField, 'otp'),
    ...field('New password', pwField, 'password'),
    ...field('Confirm password', pw2Field, 'confirm'),
    primaryBtn('Reset password', submit),
    h(
      'div',
      { class: 'gb-login-row' },
      authLink('Back to sign in', () => setAuthMode('signin', { email: state.authEmail }))
    ),
  ]);
}

function loginCard() {
  switch (state.authMode) {
    case 'signup':
      return viewSignup();
    case 'verify':
      return viewVerify();
    case 'forgot':
      return viewForgot();
    case 'reset':
      return viewReset();
    default:
      return viewSignin();
  }
}

function logout() {
  // Fire-and-forget; the token is invalidated locally either way.
  const token = loadToken();
  if (token) {
    fetch(API_BASE + '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }).catch(() => {
      /* silent */
    });
  }
  disconnectWebSocket();
  clearSession();
  state.user = null;
  state.tasks = [];
  state.habits = [];
  state.reminders = [];
  state.quote = null;
  state.score = 0;
  state.error = '';
  state.loading = false;
  state.screen = 'home';
  state.authMode = 'signin';
  state.authEmail = '';
  state.authNotice = '';
  state.goalProgress = {};
  state.money = emptyMoney();
  // Drop the hash so the URL doesn't say "#/circle" on the sign-in screen.
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  render();
}

/* ---- Loading splash (shown while data loads, e.g. on reload) ----
   Surfaces the quote of the day during the load instead of an empty screen. */
/* Placeholder the CONTENT COLUMN shows while wave-1 data is in flight.
   This used to be a full-screen splash that replaced the entire app, so the
   header, the nav and the screen all appeared together only once the fetch
   landed — and every list screen flashed its "nothing here yet" empty state on
   the way (`state.habits` and friends start as []). The shell needs nothing
   from the API, so it paints immediately and only this column waits. Reuses
   the lazy-import skeleton, with the quote-of-the-day on top: the splash was
   its only home. */
/* Bubble-shaped stand-in for the chat. The generic card skeleton under the
   Buddy header looked like the wrong screen had loaded, and then the layout
   rearranged completely when the thread landed. */
function mentorSkeleton() {
  const line = (w) => h('div', { class: 'gb-skel-line gb-msg-skel', style: { width: w } });
  const row = (user, w) =>
    h(
      'div',
      { class: 'gb-msg-row' + (user ? ' is-user' : ' is-bot') },
      user ? null : h('div', { class: 'gb-msg-avatar gb-msg-avatar--skel' }),
      line(w)
    );
  return h(
    'div',
    {
      class: 'gb-mentor gb-rise',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Loading the conversation',
    },
    h('div', { class: 'gb-msg-list' }, row(false, '58%'), row(true, '42%'), row(false, '70%')),
    h(
      'div',
      { class: 'gb-msg-bar' },
      h('div', { class: 'gb-skel-line gb-msg-input-skel' })
    )
  );
}

function loadingContent() {
  if (state.screen === 'mentor') return mentorSkeleton();
  // The boot screen is the quote and nothing else. Three grey cards used to sit
  // under it, and they were describing a screen that doesn't exist: Home lands
  // as a score ring, a daily brief and a mini calendar, never three identical
  // rows. A placeholder that lies about its own shape doesn't read as "nearly
  // there", it reads as stuck — which is exactly how it looked on a throttled
  // connection. One real card, then the actual screen.
  // screenSkeleton() still serves lazyScreen(), where the grey rows are honest:
  // that one is waiting on a chunk for a screen already on display.
  const wrap = h(
    'div',
    {
      class: 'gb-rise gb-boot-quote',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Loading',
    },
    QuoteCard({ quote: state.quote })
  );
  return wrap;
}

/* ---- Offline banner (offline-first PWA) ----
   The service worker serves the cached app shell and last-known API GETs while
   offline; this banner tells the user they're viewing cached data. */
function offlineBanner() {
  if (state.online) return null;
  return h(
    'div',
    { class: 'gb-offline-banner', role: 'status', 'aria-live': 'polite' },
    Icon('cloud-rain', { size: 15, sw: 2.4 }),
    h('span', null, "You're offline — showing your last saved data.")
  );
}

/* A gentle prompt (weekend/Monday) to do the weekly review, once per week.
   HOME ONLY. It renders in the shared `.gb-scroll` column, which every screen
   paints into, so it used to sit above all twelve of them — including the Buddy
   chat, where it stole a row from the message list and read as part of the
   conversation. The review is a Home concern; keep the "where" next to the
   "when" rather than at the call site, or the next banner repeats this. */
function weeklyReviewNudge() {
  // Not while the screen is still loading: weeklyReviewDue() reads state.trends,
  // which arrives from the Cache API a beat after boot, so mid-load the answer is
  // computed from data that isn't there yet — and a nudge to review your week
  // reads as noise stacked on a skeleton either way.
  if (state.loading || state.screen !== 'home' || !weeklyReviewDue()) return null;
  return h(
    'button',
    { type: 'button', class: 'gb-week-nudge', onclick: openWeeklyReview },
    Icon('calendar-check', { size: 16, sw: 2.4 }),
    h('span', null, 'Your week is ready to review'),
    Icon('chevron-right', { size: 16, sw: 2.4 })
  );
}

/* Friendly full-screen error state. Leads with a woozy little mascot and warm,
   blame-free copy instead of a bare "500"; keeps the raw detail muted below so
   it's still useful for support. The SVG is inline (no network) so it renders
   even when the backend is unreachable. */

/* React to connectivity changes: flag state, toast, and re-sync on reconnect. */
function handleOnline() {
  if (state.online) return;
  state.online = true;
  toastSuccess('Back online — syncing your latest data.');
  if (state.user) loadData();
  else render();
}
function handleOffline() {
  if (!state.online) return;
  state.online = false;
  pushToast("You're offline. Changes may not save until you reconnect.", 'error', 3200);
  render();
}

function render() {
  const scrollSnapshot = renderedScreen === state.screen ? captureScrollPosition() : null;
  const quietRefresh = !!scrollSnapshot;
  if (!state.user) {
    // Mount the toast stack alongside the login card so auth errors/notices
    // surface as toasts on the signed-out screen too. (toastStack() is null
    // when empty — filter it out so replaceChildren doesn't get a null.)
    root.replaceChildren(...[loginCard(), toastStack()].filter(Boolean));
    refreshIcons();
    renderedScreen = '';
    return;
  }

  // If the active screen belongs to a disabled feature, fall back to home.
  if (!screenEnabled(state.screen)) {
    state.screen = 'home';
    if (window.location.hash) history.replaceState(null, '', '#/home');
  }

  const cfg = SCREENS[state.screen] || SCREENS.home;

  const app = h(
    'div',
    { class: 'gb-app' + (quietRefresh ? ' is-refreshing' : '') },
    h(
      'a',
      {
        href: '#gb-main',
        class: 'gb-skip-link',
        onclick: (e) => {
          e.preventDefault();
          const main = document.getElementById('gb-main');
          if (main) main.focus();
        },
      },
      'Skip to main content'
    ),
    AppHeader({
      label: cfg.headerLabel(),
      name: cfg.headerName(),
      userName: state.user.displayName || 'Buddy',
      onAdd: openAddSheet,
      onAccount: toggleProfileOpen,
      unreadCount: unreadNotifs(),
      onBell: toggleNotifOpen,
    }),
    // Stable wrappers so the popovers can be repainted without rebuilding the
    // app. Both are layout-neutral: `.gb-app` is a flex column with no gap and
    // the popovers are absolutely positioned, so an empty slot is 0px tall.
    h('div', { id: 'gb-notif-slot' }, notificationDropdown()),
    h('div', { id: 'gb-profile-slot' }, profileDropdown()),
    toastStack(),
    h(
      'div',
      { class: 'gb-scroll', id: 'gb-main', role: 'main', tabindex: '-1' },
      // Banners live inside the scroll column so they sit in the content area on
      // desktop (the app shell is a grid; stray children mis-place into the sidebar).
      offlineBanner(),
      weeklyReviewNudge(),
      state.error
        ? CrashCard(() => {
            state.error = '';
            loadData();
          })
        : state.loading
          ? loadingContent()
          : cfg.render()
    ),
    bottomNav()
  );

  root.replaceChildren(app);
  refreshIcons();
  restoreScrollPosition(scrollSnapshot);
  renderedScreen = state.screen;
  installOutsideClickToCloseHeaderPopovers();
  // Any render can be the one where a badge crossed its threshold — check after
  // the DOM settles so the celebration layers over the fresh screen.
  checkAchievements();
}

/**
 * If a popover (notifications or profile) is open, close it on the next
 * mousedown anywhere outside of it, or when Escape is pressed. The handlers
 * self-remove after one fire so we don't pile up listeners across renders.
 */
/* Handle on the listeners the last install attached, so re-installing can tear
   them down first. Without it every toggle added a fresh pair of closures and
   only the pair that happened to fire got removed — bell, avatar, bell left two
   orphaned sets on `document` for the life of the session. */
let popoverCleanup = null;

function installOutsideClickToCloseHeaderPopovers() {
  if (popoverCleanup) {
    popoverCleanup();
    popoverCleanup = null;
  }
  if (!state.notifOpen && !state.profileOpen) return;
  function cleanup() {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    popoverCleanup = null;
  }
  function closePopovers() {
    cleanup();
    state.notifOpen = false;
    state.profileOpen = false;
    repaintOverlays();
  }
  function onDocDown(ev) {
    const pop = ev.target.closest('.gb-notif-pop, .gb-profile-pop, .gb-bell, .gb-avatar');
    if (pop) return; // click inside the popover or its trigger
    closePopovers();
  }
  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePopovers();
    }
  }
  popoverCleanup = cleanup;
  // Defer so the click that opened the popover doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }, 0);
}

/* ---- Boot ---- */
if (window.CacheStorage && window.CacheStorage.init) {
  window.CacheStorage.init()
    .then((hydrated) => {
      // Large client-only data (e.g. wellness photo history) may have loaded
      // from the Cache API asynchronously — re-read it and repaint if so.
      if (hydrated && state.user) {
        state.wellness = loadWellness();
        state.goalProgress = loadGoalProgress();
        state.money = loadMoney();
        state.streakFreeze = loadStreakFreeze();
        state.trends = loadTrends();
        // `gb.quote` isn't cookie-eligible, so it lives in the Cache API only and
        // the synchronous read at module load always came back null — the cache
        // above never once survived a reload, and every boot showed the generic
        // "Do one small thing today." until the network answered. Don't clobber a
        // fresher quote if loadData() already won the race.
        state.quote = state.quote || loadCachedQuote();
        reconcileStreakFreeze();
        render();
      }
    })
    .catch((err) => console.warn('CacheStorage init failed:', err));
}
initA11y();
applyTheme(state.theme);
applyPremium(state.premium);
applyTextScale(state.textScale);
if (state.user) {
  // Restore the screen from the URL fragment, so refreshing on /circle stays there.
  state.screen = screenFromHash();
  loadData();

  // Re-push the money blob every 5 minutes in case a save was lost to a dropped
  // connection. Wellness rode along here too, PUTting to an endpoint that has
  // never existed — a failure on a timer, forever. Sleep and mood are saved by
  // their own POSTs at the moment you enter them.
  setInterval(
    () => {
      if (!state.user) return;
      if (state.money && (state.money.expenses || []).length > 0) {
        api('/api/money', { method: 'PUT', body: JSON.stringify(state.money) }).catch((err) =>
          console.warn('Money sync failed:', err)
        );
      }
    },
    5 * 60 * 1000
  );
}
// Resolve the device model before anything signs in — the label rides along on
// the request that creates the session.
initNative();
render();
// The splash is held open by launchAutoHide:false — nothing else drops it.
hideNativeSplash();
window.addEventListener('load', refreshIcons);
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

/* Dev self-check for the two things here that would be wrong silently:
   toDateTimeLocal drifting by a timezone prefills the edit modal with the
   wrong hour, and optimisticScore forgetting to put the server's number back
   blanks the ring on the next render. Mirrors money.js `_demo()`. */
function _demo() {
  const a = console.assert;
  const iso = new Date(2026, 0, 5, 9, 7).toISOString();
  a(toDateTimeLocal(iso) === '2026-01-05T09:07', 'datetime-local keeps local wall clock');
  a(toDateTimeLocal('not a date') === '', 'unparseable date → empty');
  const server = state.score;
  state.score = 42;
  optimisticScore();
  a(state.score === 42, 'optimisticScore leaves the server score alone');
  state.score = server;
  console.log('[app] self-check ran');
}
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    _demo();
  } catch (_) {
    /* never block the app */
  }
}
