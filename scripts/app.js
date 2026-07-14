/* =====================================================================
   Growth Buddy — App shell: state, routing, render
   ===================================================================== */
import SockJS from 'sockjs-client';
import { Client as StompClient } from '@stomp/stompjs';
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
  Logo,
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
import { ScreenGoals } from './goals.js';
import { ScreenMoney, emptyMoney, normalizeMoney, MoneyCustomisePane } from './money.js';
import {
  ScreenCalendar,
  RenderCalendarToolbar,
  RenderCalendarSide,
  RenderCalendarGrid,
  resetCalendarForm,
} from './calendar.js';
import { ScreenMentor } from './mentor.js';
import { ScreenFamily } from './family.js';
import { ScreenCircle } from './circle.js';
import { ScreenReport } from './report.js';
import { ScreenAchievements, computeAchievements } from './achievements.js';
import { celebrate } from './celebrate.js';
import { enablePush, disablePush, pushSubscribed, pushSupported } from './push.js';
import { ScreenFocus } from './timer.js';
import { CacheStorage } from './cache-storage.js';
import { registerToast } from './toast.js';
import { initA11y } from './a11y.js';

// Prefer the build-time env (VITE_API_BASE). In dev, fall back to '' so requests
// are same-origin (relative) and flow through the Vite proxy to the backend. In a
// non-dev build with nothing configured, use the local backend default.
// NOTE: no runtime (cookie-backed) override — a planted `gb.apiBase` cookie could
// otherwise redirect every API call, bearer token attached, to an attacker host.
// In dev only, still honor it for convenience.
const API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) ||
  (import.meta.env && import.meta.env.DEV
    ? CacheStorage.getItem('gb.apiBase') || ''
    : 'http://localhost:8080');
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
  screen: 'home',
  loading: false,
  error: '',
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
  // Read-only Google Calendar events, reminder-shaped, cached per visible
  // month ('YYYY-MM' → [{ id, date, time, text, tag:'google', google:true }]).
  googleEventsByMonth: {},
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
  };
  state.toasts = [...state.toasts.filter((t) => t.message !== text), toast].slice(-4);
  render();
  const duration = typeof durationMs === 'number' ? durationMs : 2800;
  setTimeout(() => dismissToast(toast.id), duration);
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

function persistWellness() {
  try {
    CacheStorage.setItem(
      wellnessStorageKey(state.user),
      JSON.stringify(state.wellness || emptyWellness())
    );
  } catch (err) {
    console.error('⚠️ Failed to cache wellness data locally:', err);
  }
  // CRITICAL: Also sync to database immediately (not just cache)
  if (state.user && state.wellness) {
    api('/api/daily-logs', {
      method: 'PUT',
      body: JSON.stringify({
        sleepByDate: state.wellness.sleepByDate || {},
        moodByDate: state.wellness.moodByDate || {}
      })
    }).catch((err) => {
      console.error('❌ CRITICAL: persistWellness failed to reach database:', err);
    });
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

function saveMoney(next) {
  // Optimistic: update local + cache + repaint immediately, then persist to the
  // server (mirrors saveHomeLayout). Offline writes still land in the cache.
  state.money = normalizeMoney(next);
  cacheMoney();
  render();
  // CRITICAL: This MUST reach the database. Log all failures prominently.
  api('/api/money', { method: 'PUT', body: JSON.stringify(state.money) }).catch((err) => {
    console.error('❌ CRITICAL: saveMoney failed to reach database:', err);
    toastError(err, '❌ Money data NOT saved to database. Check your connection and try again.');
  });
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
      document.documentElement.setAttribute('data-theme', p.theme);
    }
    if (typeof p.qaLang === 'string') localStorage.setItem('gb.qa.lang', p.qaLang);
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

function syncUserSession(userPatch) {
  const token = loadToken();
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

async function apiFetch(path, options) {
  const opts = options || {};
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  const token = loadToken();
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
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
    let msg = 'Request failed (' + res.status + ')';
    try {
      const err = await res.json();
      msg = err.message || msg;
    } catch (_) {
      // ignored
    }
    throw new Error(msg);
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
  state.googleEventsByMonth = {};
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
  const suffix = task.completionCount > 0 ? ' - done ' + task.completionCount + 'x' : '';
  if (task.dueAt) {
    try {
      const dt = new Date(task.dueAt);
      const base =
        dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' · ' +
        dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return (isOverdue ? 'Overdue - ' : '') + base + suffix;
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

/* ---- Google Calendar (read-only) ---- */

/** Reminders plus the cached read-only Google events, for calendar views. */
function calendarReminders() {
  const google = Object.values(state.googleEventsByMonth).flat();
  return google.length ? state.reminders.concat(google) : state.reminders;
}

/** Refetch a month once its cache is this old, so edits made in Google show up. */
const GCAL_FRESH_MS = 60 * 1000;
const gcalFetchedAt = {};

/** Fetch the user's Google events for one month (no-op if not connected). */
async function loadGoogleEventsForMonth(year, month, opts) {
  if (!state.user) return;
  const key = dateKey(year, month, 1).slice(0, 7); // 'YYYY-MM'
  const fresh = gcalFetchedAt[key] && Date.now() - gcalFetchedAt[key] < GCAL_FRESH_MS;
  if (fresh && !(opts && opts.force)) return;
  gcalFetchedAt[key] = Date.now(); // stamp up front so overlapping calls don't double-fetch
  try {
    const r = await api('/api/google/calendar/events?month=' + key);
    if (!r || !r.connected) return;
    const events = (r.events || []).map((ev) => ({
      id: 'gcal:' + ev.id,
      date: ev.date,
      time: ev.time || '',
      text: ev.title || '(no title)',
      tag: 'google',
      repeat: 'none',
      google: true,
    }));
    // Skip the repaint when nothing changed (refetches happen on every tab focus).
    if (JSON.stringify(state.googleEventsByMonth[key]) === JSON.stringify(events)) return;
    state.googleEventsByMonth[key] = events;
    if (state.screen === 'calendar') {
      repaintCalendarGrid();
      rerenderCalendarSideIfActive();
    } else {
      rerenderHomeMiniCalendarIfActive();
    }
  } catch (_) {
    delete gcalFetchedAt[key]; // retry on the next trigger
  }
}

/**
 * The month grid renders 42 cells, so its first and last rows show days from
 * the neighbouring months — load those too so their dots aren't missing.
 */
function loadGoogleEventsAroundMonth(year, month) {
  loadGoogleEventsForMonth(year, month);
  loadGoogleEventsForMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  loadGoogleEventsForMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
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
    reminders: calendarReminders(),
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
    reminders: calendarReminders(),
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

async function loadData() {
  if (!state.user) {
    return;
  }
  state.loading = true;
  state.error = '';
  render();
  try {
    const [
      tasksRaw,
      habits,
      goals,
      reminders,
      quote,
      todayScore,
      notifications,
      water,
      food,
      money,
      dailyLogs,
      photoHistory,
    ] = await Promise.all([
      api('/api/tasks'),
      api('/api/habits'),
      api('/api/goals'),
      api('/api/reminders'),
      api('/api/quotes/today'),
      api('/api/score/today'),
      api('/api/notifications'),
      api('/api/water'),
      api('/api/food'),
      // CRITICAL: Money MUST come from DB, not cache. Fail loudly if unavailable.
      api('/api/money').catch((err) => {
        console.error('⚠️ CRITICAL: Money API failed - data will NOT persist!', err);
        return null;
      }),
      // CRITICAL: Sleep/mood + trends MUST come from DB. Fail loudly if unavailable.
      api('/api/daily-logs?days=60').catch((err) => {
        console.error('⚠️ CRITICAL: Daily logs API failed - sleep/mood data will NOT persist!', err);
        return null;
      }),
      // CRITICAL: Photo history MUST come from DB. Fail loudly if unavailable.
      api('/api/food/photo-history').catch((err) => {
        console.error('⚠️ CRITICAL: Photo history API failed - photos will NOT persist!', err);
        return null;
      }),
    ]);

    const tasks = await resetStaleCompletedTasks(tasksRaw);

    state.tasks = tasks.map(mapTask);
    state.habits = habits;
    reconcileStreakFreeze();
    state.goals = goals || [];
    // Per-goal progress (milestones, day-tracker) now rides on each goal from
    // the backend; rebuild the id-keyed map and mirror it to the local cache.
    const gp = {};
    (goals || []).forEach((sec) =>
      (sec.goals || []).forEach((g) => {
        if (g && g.progress) gp[String(g.id)] = g.progress;
      })
    );
    state.goalProgress = gp;
    persistGoalProgress();
    state.reminders = reminders;
    state.quote = quote;
    cacheQuote(quote);
    state.water = water;
    state.food = food;
    cacheFoodSummary(food);
    if (money) {
      state.money = normalizeMoney(money);
      cacheMoney();
    }
    // Sleep/mood + trends now live on the backend. Merge in the server data,
    // keep the local-only photo history, and mirror to cache for offline paint.
    if (dailyLogs) {
      const localWell = loadWellness();
      state.wellness = {
        sleepByDate: dailyLogs.sleepByDate || {},
        moodByDate: dailyLogs.moodByDate || {},
        // Photo history comes from its own endpoint; fall back to the cache.
        photoHistory: photoHistory != null ? photoHistory : localWell.photoHistory || [],
      };
      state.trends = { byDate: dailyLogs.byDate || {} };
      persistWellness();
      persistTrends();
    } else if (photoHistory != null) {
      state.wellness = Object.assign(emptyWellness(), state.wellness || {}, { photoHistory });
      persistWellness();
    }
    loadCalendarFoodForDate(state.selectedDate);
    loadGoogleEventsForMonth(state.calYear, state.calMonth);
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : 0;
    state.notifications = notifications || [];
    // Weekly reviews (backend-backed) → { weekStart: {wins,focus,savedAt} } map.
    try {
      const weekly = await api('/api/weekly-review');
      const map = {};
      (weekly || []).forEach((w) => {
        map[w.weekStart] = { wins: w.wins, focus: w.focus, savedAt: w.savedAt };
      });
      state.weeklyReviews = map;
    } catch (_) {
      /* keep whatever we had */
    }
    recordTrendsToday();
    // Data is now complete, so achievement detection can baseline/fire safely.
    state.achReady = true;
    
    // CRITICAL: On app startup, force-sync money and wellness from cache to DB
    // in case they were only updated locally before. Do this async to not block render.
    setTimeout(() => {
      if (state.money) {
        console.log('🔄 [Startup] Force-syncing money data to database...');
        api('/api/money', { method: 'PUT', body: JSON.stringify(state.money) })
          .then(() => console.log('✅ [Startup] Money data verified in database'))
          .catch((err) => console.error('❌ [Startup] Money sync failed:', err));
      }
      if (state.wellness && (Object.keys(state.wellness.sleepByDate || {}).length > 0 || 
                              Object.keys(state.wellness.moodByDate || {}).length > 0)) {
        console.log('🔄 [Startup] Force-syncing wellness data to database...');
        api('/api/daily-logs', {
          method: 'PUT',
          body: JSON.stringify({
            sleepByDate: state.wellness.sleepByDate || {},
            moodByDate: state.wellness.moodByDate || {}
          })
        }).then(() => console.log('✅ [Startup] Wellness data verified in database'))
          .catch((err) => console.error('❌ [Startup] Wellness sync failed:', err));
      }
    }, 100);
    
    connectWebSocket();
  } catch (err) {
    state.error = err.message || 'Failed to load data from backend.';
  } finally {
    state.loading = false;
    render();
  }
}

/* ---- WebSocket: realtime notification push ---- */
function connectWebSocket() {
  if (!state.user || stomp) return;
  const token = loadToken();
  if (!token) return;
  try {
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

async function toggleTask(id) {
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
    toastError(err, 'Could not toggle task.');
  }
}

async function toggleHabit(id) {
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
  const fmt = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
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
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    amount: Math.round(amount),
    category: 'others',
    date: todayKeyNow(),
    note: note || '',
    createdAt: Date.now(),
  });
  saveMoney(next);
}
async function runQuickAdd(text) {
  const habits = (state.habits || []).map((hb) => hb.name).filter(Boolean).slice(0, 100);
  const res = await api('/api/quick-add', { method: 'POST', body: JSON.stringify({ text, habits }) });
  if (!res || res.configured === false) return { configured: false, applied: 0 };
  const intents = res.intents || [];
  let applied = 0;
  for (const it of intents) {
    try {
      if (it.type === 'task' && it.title) {
        await createTask({ title: it.title });
        applied++;
      } else if (it.type === 'habit' && it.name) {
        const hb = (state.habits || []).find((x) => (x.name || '').toLowerCase() === it.name.toLowerCase());
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
  toastSuccess('Goal added.');
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
  toastSuccess('Action removed.');
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
    { style: { fontSize: '12px', color: 'var(--fg3)' } },
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
          fontSize: '13px',
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
          fontSize: '12px',
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
      { style: { fontSize: '12px', color: 'var(--fg3)', marginTop: '8px' } },
      'No grams needed. We estimate from food name and optional plate photo.'
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
        entriesToAdd = [
          {
            foodName: foodName,
            quantityGrams: quantityRaw != null ? Math.round(quantityRaw) : null,
            mealType: mealType,
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
    render();
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
    render();
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
  render();
}

function toggleProfileOpen() {
  state.profileOpen = !state.profileOpen;
  state.notifOpen = false;
  state.moreOpen = false;
  render();
}

function toggleMoreOpen() {
  state.moreOpen = !state.moreOpen;
  state.notifOpen = false;
  state.profileOpen = false;
  render();
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
          render();
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
          render();
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
        class: 'gb-profile-pop-item',
        onclick: () => {
          state.profileOpen = false;
          render();
          openSecurity();
        },
      },
      Icon('shield', { size: 16 }),
      'Security'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-profile-pop-item',
        onclick: () => {
          state.profileOpen = false;
          render();
          openCustomise();
        },
      },
      Icon('pencil', { size: 16 }),
      'Customise'
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

const SCREEN_IDS = [
  'home',
  'achievements',
  'focus',
  'habits',
  'food',
  'goals',
  'money',
  'calendar',
  'mentor',
  'circle',
  'family',
];

/** Parse the current location hash → screen id. Defaults to home. */
function screenFromHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
  return SCREEN_IDS.includes(raw) ? raw : 'home';
}

function setScreen(id, opts) {
  opts = opts || {};
  // Tapping a "More" item that's already active should still close the sheet.
  if (state.screen === id && !opts.force) {
    if (state.moreOpen) {
      state.moreOpen = false;
      render();
    }
    return;
  }
  state.screen = id;
  state.notifOpen = false;
  state.profileOpen = false;
  state.moreOpen = false;
  if (id === 'calendar') {
    loadGoogleEventsAroundMonth(state.calYear, state.calMonth);
  }
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

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  try {
    CacheStorage.setItem(THEME_KEY, state.theme);
  } catch (_) {}
  saveUiPrefs({ theme: state.theme });
  render();
}

async function saveProfileDetails(payload) {
  const updated = await api('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  syncUserSession(updated);
  toastSuccess('Profile updated.');
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

/**
 * A country-code dropdown + local-number field. Users pick their country
 * so they can't forget the dial code (which previously produced broken
 * numbers like +6374044117). `getValue()` returns a full E.164 string.
 */
function CountryPhoneInput(prefill) {
  // Split any existing number into (dial, local) by longest-prefix match.
  const digits = String(prefill || '').replace(/\D/g, '');
  let dial = '91',
    local = digits;
  if (digits) {
    const byLen = COUNTRY_CODES.slice().sort((a, b) => b.d.length - a.d.length);
    const hit = byLen.find((co) => digits.startsWith(co.d) && digits.length > co.d.length);
    if (hit) {
      dial = hit.d;
      local = digits.slice(hit.d.length);
    }
  }

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

/* ---- Customise: standalone modal with Home + Features tabs ---- */
function openCustomise(initialTab) {
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
      'Choose which cards appear on Home and reorder them with the arrows. Changes save automatically.'
    ),
    homeListEl
  );

  // Navigation tab — choose which destinations sit in the bottom bar vs
  // "More", and reorder them. Saves automatically. Mirrors the Home pane.
  const NAV_BAR_MAX = 5;
  let navWorking = resolveNavLayout((u && u.navLayout) || null);
  const navListEl = h('div', { class: 'gb-home-cust-list' });
  const persistNav = () =>
    saveNavLayout(navWorking.map((x) => ({ id: x.id, primary: x.primary })));
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
      'Pick which destinations sit in the bottom bar (up to ' +
        NAV_BAR_MAX +
        ') and reorder them with the arrows. The rest live under “More”. Changes save automatically.'
    ),
    navListEl
  );

  // Money tab — tags, currency and prompts. Only when the feature is on.
  const moneyPane = featureOn('money')
    ? h('div', { class: 'gb-settings-pane' }, MoneyCustomisePane(state.money, saveMoney))
    : null;

  // Tabs share one segmented slider; Money joins when enabled.
  const tabs = [
    { id: 'home', label: 'Home', pane: homePane },
    { id: 'nav', label: 'Navigation', pane: navPane },
    { id: 'features', label: 'Features', pane: featuresPane },
  ];
  if (moneyPane) tabs.push({ id: 'money', label: 'Money', pane: moneyPane });
  const initial = tabs.some((t) => t.id === initialTab) ? initialTab : 'home';
  const bar = buildSegSlider(tabs, initial);

  openModal({
    title: 'Customise',
    sub: 'Personalise your home screen, navigation and features',
    body: h(
      'div',
      { class: 'gb-settings-body' },
      bar,
      homePane,
      navPane,
      featuresPane,
      ...(moneyPane ? [moneyPane] : [])
    ),
    primary: 'Done',
    onPrimary: async () => {},
    modalClass: 'gb-modal--settings',
  });
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
/** Is a weekly review due? (weekend/Monday, and not yet done this week.) */
function weeklyReviewDue() {
  const dow = new Date().getDay(); // 0 Sun, 1 Mon, 6 Sat
  const isWindow = dow === 0 || dow === 1 || dow === 6;
  const done = !!loadWeekly()[weekStartKey(new Date())];
  return isWindow && !done && !!state.user;
}
function weeklyReviewStats() {
  const days = last7Keys();
  const byDate = (state.trends && state.trends.byDate) || {};
  const scores = days.map((k) => byDate[k] && Number(byDate[k].score)).filter((n) => Number.isFinite(n) && n > 0);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
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
    h('div', { class: 'gb-wr-tile' },
      h('div', { class: 'gb-wr-tile-val' }, value),
      h('div', { class: 'gb-wr-tile-lbl' }, label));

  const wins = h('textarea', {
    class: 'gb-input', rows: '2', maxlength: '400',
    placeholder: 'One thing that went well…',
  });
  // A <textarea>'s initial text can't be set via the value attribute — set the
  // property so an existing review's wins prefill when re-opened.
  wins.value = prev.wins || '';
  const focus = h('input', {
    type: 'text', class: 'gb-input', maxlength: '120',
    placeholder: 'e.g. Protect my mornings for deep work', value: prev.focus || '',
  });
  const saveBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary' }, prev.focus ? 'Update review' : 'Save review');
  saveBtn.addEventListener('click', async () => {
    const weekStart = weekStartKey(new Date());
    const payload = { weekStart, wins: wins.value.trim(), focus: focus.value.trim() };
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const saved = await api('/api/weekly-review', { method: 'PUT', body: JSON.stringify(payload) });
      // Mirror into state so the nudge/prefill update without a reload.
      if (!state.weeklyReviews) state.weeklyReviews = {};
      state.weeklyReviews[weekStart] = { wins: saved.wins, focus: saved.focus, savedAt: saved.savedAt };
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
    h('div', { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Your week in review'),
      h('div', { class: 'gb-modal-sub' }, 'A quick look back, then set one focus for the week ahead.')),
    h('div', { class: 'gb-wr-tiles' },
      tile(s.avgScore + '%', 'avg score'),
      tile(String(s.activeDays) + '/7', 'active days'),
      tile(String(s.topStreak), 'best streak'),
      tile(cur() + s.spend, 'spent'),
      tile(String(s.moodLogs), 'mood logs')),
    h('div', { class: 'gb-field-label' }, 'What went well?'),
    wins,
    h('div', { class: 'gb-field-label' }, 'Your one focus for next week'),
    focus,
    saveBtn,
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() }, 'Maybe later')
  );
  overlay = h('div', { class: 'gb-modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, sheet);
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
  const pw = h('input', { type: 'password', class: 'gb-input', autocomplete: 'current-password', placeholder: 'Your password' });
  const confirmBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--danger' }, 'Delete my account');
  confirmBtn.addEventListener('click', async () => {
    if (!pw.value) {
      pushToast('Enter your password to confirm.', 'error', 3000);
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await api('/api/auth/delete-account', { method: 'POST', body: JSON.stringify({ password: pw.value }) });
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
    h('div', { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Delete your account?'),
      h('div', { class: 'gb-modal-sub' }, 'This permanently erases your habits, tasks, goals, logs and money data. It can’t be undone.')),
    h('div', { class: 'gb-form' },
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Confirm with your password'),
      pw,
      confirmBtn),
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() }, 'Keep my account')
  );
  overlay = h('div', { class: 'gb-modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, sheet);
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  setTimeout(() => pw.focus(), 60);
}

/* ---- Security modal: active sessions + change password ---- */
function openSecurity() {
  let overlay;
  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  };

  const sessionsWrap = h('div', { class: 'gb-sec-sessions' }, h('div', { class: 'gb-empty-sm' }, 'Loading…'));

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
                        await api('/api/auth/sessions/' + encodeURIComponent(s.id), { method: 'DELETE' });
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

  const curPw = h('input', { type: 'password', class: 'gb-input', autocomplete: 'current-password' });
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
      state.user = resp;
      saveSession(resp, resp.token);
      toastSuccess('Password updated. Other devices were signed out.');
      close();
    } catch (err) {
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
      toastError(err, 'Could not update password.');
    }
  }
  pwBtn.addEventListener('click', changePassword);

  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Security' },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Security'),
      h('div', { class: 'gb-modal-sub' }, 'Devices signed in to your account, and your password.')
    ),
    h('div', { class: 'gb-field-label' }, 'Signed-in devices'),
    sessionsWrap,
    h('div', { class: 'gb-sec-divider' }),
    h('div', { class: 'gb-field-label' }, 'Change password'),
    h(
      'div',
      { class: 'gb-form' },
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Current password'),
      curPw,
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'New password (8+ characters)'),
      newPw,
      pwBtn
    ),
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() }, 'Close')
  );
  overlay = h(
    'div',
    { class: 'gb-modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  loadSessions();
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
        class: 'gb-input gb-input--otp',
        maxlength: '6',
        placeholder: '6-digit code',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
      });
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
          otpIn.focus();
          toastError(new Error('Enter the 6-digit code from WhatsApp'), 'Invalid code');
          return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying…';
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
      waSectionBody.appendChild(otpIn);
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
        cu.whatsappNumber || '',
        h('span', { class: 'gb-wa-verified-label' }, 'Verified')
      );
      const changeBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-wa-change-link',
          style: { marginLeft: 'auto' },
        },
        'Change'
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

  // ---- Google Calendar integration (read-only) ----
  const gcalBody = h('div', null, h('div', { class: 'gb-field-hint' }, 'Checking…'));
  let gcalPollTimer = 0;

  function renderGcal(status) {
    clearTimeout(gcalPollTimer);
    gcalBody.replaceChildren();
    if (status && status.connected) {
      const disconnectBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: async () => {
            disconnectBtn.disabled = true;
            try {
              await api('/api/google/calendar', { method: 'DELETE' });
              state.googleEventsByMonth = {};
              renderGcal({ connected: false });
              toastSuccess('Google Calendar disconnected.');
            } catch (err) {
              disconnectBtn.disabled = false;
              toastError(err, 'Could not disconnect Google Calendar.');
            }
          },
        },
        'Disconnect'
      );
      gcalBody.appendChild(
        h(
          'div',
          { class: 'gb-account-row' },
          h(
            'span',
            { class: 'gb-pill', style: { background: 'var(--leaf-50)', color: 'var(--leaf-700)' } },
            'Connected' + (status.email ? ' · ' + status.email : '')
          ),
          disconnectBtn
        )
      );
    } else if (status && status.configured === false) {
      // No Google OAuth client yet — guided one-time setup, right here in the UI.
      const stepStyle = { margin: '0 0 8px', paddingLeft: '18px' };
      const clientIdInput = h('input', {
        type: 'text',
        class: 'gb-input',
        placeholder: 'ends with .apps.googleusercontent.com',
        autocomplete: 'off',
        spellcheck: 'false',
      });
      const secretInput = h('input', {
        type: 'password',
        class: 'gb-input',
        placeholder: 'starts with GOCSPX-',
        autocomplete: 'new-password',
      });
      const uriCode = h(
        'code',
        {
          style: {
            font: '12px/1.6 ui-monospace, monospace',
            wordBreak: 'break-all',
            flex: '1',
            minWidth: 0,
          },
        },
        'Loading…'
      );
      const copyBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(uriCode.textContent);
              copyBtn.textContent = 'Copied';
              setTimeout(() => (copyBtn.textContent = 'Copy'), 1600);
            } catch (_) {
              toastError(new Error('Copy failed — select the text and copy it by hand.'));
            }
          },
        },
        'Copy'
      );
      const saveBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { marginTop: '10px' },
          onclick: async () => {
            const clientId = clientIdInput.value.trim();
            const clientSecret = secretInput.value.trim();
            if (!clientId || !clientSecret) {
              (clientId ? secretInput : clientIdInput).focus();
              toastError(new Error('Paste both keys from Google first.'));
              return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
              await api('/api/google/calendar/config', {
                method: 'PUT',
                body: JSON.stringify({ clientId, clientSecret }),
              });
              toastSuccess('Google Calendar is switched on for everyone.');
              renderGcal({ configured: true, connected: false });
            } catch (err) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save & switch on';
              toastError(err, 'Could not save the Google keys.');
            }
          },
        },
        'Save & switch on'
      );
      api('/api/google/calendar/config')
        .then((c) => {
          uriCode.textContent = c.redirectUri || '';
          if (c.clientId) clientIdInput.value = c.clientId;
        })
        .catch(() => {
          uriCode.textContent = 'Could not load — is the server running?';
        });
      gcalBody.appendChild(
        h(
          'div',
          null,
          h(
            'div',
            { class: 'gb-field-hint', style: { marginBottom: '10px' } },
            'One-time setup by whoever runs this app. After this, everyone just taps “Connect”.'
          ),
          h(
            'ol',
            { class: 'gb-field-hint', style: stepStyle },
            h(
              'li',
              { style: { marginBottom: '6px' } },
              'Open console.cloud.google.com and enable the “Google Calendar API”.'
            ),
            h(
              'li',
              { style: { marginBottom: '6px' } },
              'Under Credentials, create an OAuth client ID (type: Web application) and paste this redirect URI into “Authorized redirect URIs”:',
              h(
                'span',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    borderRadius: '10px',
                    margin: '6px 0 2px',
                  },
                },
                uriCode,
                copyBtn
              )
            ),
            h('li', null, 'Copy the two keys Google shows you into these boxes:')
          ),
          h('div', { class: 'gb-field-label' }, 'Client ID'),
          clientIdInput,
          h('div', { class: 'gb-field-label' }, 'Client secret'),
          secretInput,
          saveBtn
        )
      );
    } else {
      const connectBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: async () => {
            connectBtn.disabled = true;
            clearTimeout(gcalPollTimer); // a second click must not stack poll loops
            try {
              const r = await api('/api/google/calendar/connect', { method: 'POST' });
              // Google refuses OAuth inside a WebView, so the Capacitor app must
              // hand the consent page to the system browser (Custom Tab / Safari VC).
              const capBrowser =
                window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
              if (capBrowser) {
                capBrowser.open({ url: r.url });
              } else {
                window.open(r.url, '_blank', 'noopener');
              }
              // Consent happens in another tab; poll until it lands (or the modal closes).
              const poll = async () => {
                if (!gcalBody.isConnected) return;
                try {
                  const s = await api('/api/google/calendar/status');
                  if (s.connected) {
                    state.googleEventsByMonth = {};
                    loadGoogleEventsForMonth(state.calYear, state.calMonth, { force: true });
                    renderGcal(s);
                    toastSuccess('Google Calendar connected.');
                    return;
                  }
                } catch (_) {
                  /* keep polling */
                }
                gcalPollTimer = setTimeout(poll, 2500);
              };
              gcalPollTimer = setTimeout(poll, 2500);
            } catch (err) {
              toastError(err, 'Could not start the Google connection.');
            } finally {
              connectBtn.disabled = false;
            }
          },
        },
        'Connect Google Calendar'
      );
      gcalBody.appendChild(
        h(
          'div',
          { class: 'gb-quickadd-row', style: { flexWrap: 'wrap' } },
          connectBtn,
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-btn--compact',
              onclick: () => renderGcal({ configured: false, connected: false }),
            },
            'Change setup keys'
          )
        )
      );
    }
    refreshIcons();
  }
  api('/api/google/calendar/status')
    .then(renderGcal)
    .catch(() => {
      gcalBody.replaceChildren(
        h('div', { class: 'gb-field-hint' }, 'Could not check Google Calendar status.')
      );
    });

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
    h('div', { class: 'gb-field-hint' }, 'IANA format — e.g. Asia/Kolkata, America/New_York'),
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
  const digestSaveBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--soft', style: { marginTop: '4px' } },
    'Save digest preferences'
  );
  digestSaveBtn.onclick = async () => {
    try {
      digestSaveBtn.disabled = true;
      await saveDigestPrefs(digestFreqSel.value, parseInt(digestHourSel.value, 10));
      toastSuccess('Digest preferences saved.');
    } catch (err) {
      toastError(err, 'Could not save digest preferences.');
    } finally {
      digestSaveBtn.disabled = false;
    }
  };
  const digestSectionBody = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Frequency'),
    digestFreqSel,
    h('div', { class: 'gb-field-label' }, 'Send around'),
    digestHourSel,
    h(
      'div',
      { class: 'gb-field-hint', style: { margin: '6px 0 12px' } },
      'Weekly digests arrive on Mondays. Delivered by email and as an in-app notification.'
    ),
    digestSaveBtn
  );

  // ---- Push notifications ----
  const pushBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact' }, 'Enable push notifications');
  const pushTestBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact' }, 'Send test');
  let pushOn = false;
  const syncPushUi = () => {
    pushBtn.textContent = pushOn ? 'Turn off push notifications' : 'Enable push notifications';
    pushTestBtn.style.display = pushOn ? '' : 'none';
  };
  syncPushUi();
  if (pushSupported()) pushSubscribed().then((on) => { pushOn = on; syncPushUi(); });
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
          pushToast('Notifications are blocked — enable them in your browser settings.', 'error', 4200);
        } else if (r === 'unsupported') {
          pushToast('This browser doesn’t support push notifications.', 'error', 4200);
        } else {
          pushToast('Could not enable push. Please try again.', 'error', 3600);
        }
      }
    } finally {
      pushBtn.disabled = false;
      syncPushUi();
    }
  };
  pushTestBtn.onclick = async () => {
    try {
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
  const pushSectionBody = h('div', { class: 'gb-quickadd-row', style: { flexWrap: 'wrap' } }, pushBtn, pushTestBtn);

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
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '22px' } }, 'WhatsApp reminders'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '14px' } },
      'Verify your WhatsApp number once. After that, calendar reminders with a set time will be delivered to WhatsApp.'
    ),
    waSectionBody,
    h('div', { class: 'gb-settings-sec-label', style: { marginTop: '22px' } }, 'Progress digest'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '12px' } },
      'Get a short recap of your score, tasks and habits to stay on track.'
    ),
    digestSectionBody
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
    h(
      'div',
      {
        class: 'gb-settings-sec-label',
        style: { marginTop: '20px', display: 'flex', alignItems: 'center', gap: '4px' },
      },
      'Integrations',
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn',
          style: { width: '26px', height: '26px', boxShadow: 'none' },
          'aria-label': 'What is Google Calendar sync?',
          onclick: () =>
            openModal({
              title: 'What is Google Calendar sync?',
              body: h(
                'div',
                { class: 'gb-settings-pane' },
                h(
                  'div',
                  { class: 'gb-field-hint', style: { marginBottom: '10px' } },
                  'It shows the events from your own Google Calendar inside the Growth Buddy calendar, so everything is in one place.'
                ),
                h('div', { class: 'gb-field-label' }, 'How to turn it on'),
                h(
                  'div',
                  { class: 'gb-field-hint', style: { marginBottom: '10px' } },
                  '1. Tap “Connect Google Calendar”.  2. Choose your Google account.  3. Tap “Allow”. That’s all — your events appear on the Calendar screen with a blue “Google” label.'
                ),
                h('div', { class: 'gb-field-label' }, 'Is it safe?'),
                h(
                  'div',
                  { class: 'gb-field-hint' },
                  'Yes. Growth Buddy can only read your events — it can never change, add or delete anything in your Google Calendar. You can tap “Disconnect” here at any time to stop sharing.'
                )
              ),
              primary: 'Got it',
              onPrimary: () => {},
            }),
        },
        Icon('info', { size: 15 })
      )
    ),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '10px' } },
      'Show your Google Calendar events in the Growth Buddy calendar. Read-only — we never change your Google Calendar.'
    ),
    gcalBody,
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
  const tabDefs = [
    { id: 'profile', label: 'Profile', pane: profilePane },
    { id: 'notifications', label: 'Alerts', pane: notifPane },
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
    profilePane,
    notifPane,
    accountPane
  );

  openModal({
    title: 'Settings',
    sub: null,
    body,
    primary: 'Save changes',
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
    reminders: calendarReminders(),
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
  loadGoogleEventsAroundMonth(state.calYear, state.calMonth);
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
    repaintCalendarGrid();
    rerenderCalendarSideIfActive();
  } else if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
    // mini calendar updated in place
  } else {
    render();
  }
  loadCalendarFoodForDate(state.selectedDate);
  loadGoogleEventsForMonth(state.calYear, state.calMonth);
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

async function addReminder(key, text, time, tag, repeat, until) {
  if (!text) return;
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
    reminders: calendarReminders(),
    onSelectDate: selectDate,
  });
  grid.replaceWith(fresh);
  refreshIcons();
}

// scope: 'all' | 'this' | 'future' | 'before'
async function deleteReminder(scope, id, occKey) {
  try {
    const qs = new URLSearchParams();
    qs.set('scope', scope || 'all');
    if (occKey) {
      qs.set('date', occKey);
    }
    await api('/api/reminders/' + encodeURIComponent(id) + '?' + qs.toString(), {
      method: 'DELETE',
    });
    state.reminders = await api('/api/reminders');
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      repaintCalendarGrid();
    } else {
      render();
    }
    toastSuccess('Reminder deleted.');
  } catch (err) {
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
  const qaBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact' }, 'Log it');
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

  // Voice input via the native Web Speech API — recognizes one language at a
  // time, so a small chip toggles English / Tamil (choice remembered).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let micBtn = null;
  let langBtn = null;
  if (SR) {
    const LANGS = [
      { code: 'en-IN', label: 'EN' },
      { code: 'ta-IN', label: 'தமிழ்' },
    ];
    let langIdx = localStorage.getItem('gb.qa.lang') === 'ta-IN' ? 1 : 0;
    langBtn = h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--compact', 'aria-label': 'Voice language' },
      LANGS[langIdx].label
    );
    micBtn = h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--compact gb-mic', 'aria-label': 'Speak instead of typing' },
      Icon('mic', { size: 18 })
    );
    let rec = null;
    langBtn.addEventListener('click', () => {
      langIdx = (langIdx + 1) % LANGS.length;
      localStorage.setItem('gb.qa.lang', LANGS[langIdx].code);
      saveUiPrefs({ qaLang: LANGS[langIdx].code });
      langBtn.textContent = LANGS[langIdx].label;
      if (rec) rec.stop();
    });
    micBtn.addEventListener('click', () => {
      if (rec) {
        rec.stop();
        return;
      }
      rec = new SR();
      rec.lang = LANGS[langIdx].code;
      rec.interimResults = false;
      micBtn.classList.add('is-listening');
      rec.onresult = (e) => {
        const said = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
        if (said) qaInput.value = (qaInput.value ? qaInput.value + ' ' : '') + said;
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') pushToast('Microphone access was blocked.', 'error', 3600);
      };
      rec.onend = () => {
        micBtn.classList.remove('is-listening');
        rec = null;
        qaInput.focus();
      };
      rec.start();
    });
  }

  const quickAddBox = h(
    'div',
    { class: 'gb-quickadd' },
    h('div', { class: 'gb-quickadd-row' }, qaInput, micBtn, langBtn, qaBtn),
    h(
      'div',
      { class: 'gb-quickadd-hint' },
      SR
        ? 'Type or speak it naturally — English or Tamil — I’ll file it into the right place.'
        : 'Type it naturally — English or Tamil — I’ll file it into the right place.'
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
      sub: 'On a specific day or time',
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
      h('div', { class: 'gb-modal-sub' }, 'Type it in one line, or pick below.')
    ),
    quickAddBox,
    h('div', { class: 'gb-quickadd-or' }, 'or add manually'),
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

function openAddTask() {
  const titleInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Finish the design review',
    maxlength: 255,
  });
  const priority = segmented(
    [
      { value: 'Low', label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' },
    ],
    'Medium'
  );
  const dueInput = h('input', { type: 'datetime-local', class: 'gb-input' });

  const body = h(
    'div',
    { class: 'gb-form' },
    h('div', { class: 'gb-field-label' }, 'Title'),
    titleInput,
    h('div', { class: 'gb-field-label' }, 'Priority'),
    priority.node,
    h('div', { class: 'gb-field-label' }, 'Due (optional)'),
    dueInput
  );

  openModal({
    title: 'New task',
    body,
    primary: 'Add task',
    onPrimary: async () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        throw new Error('Title is required');
      }
      const due = dueInput.value ? new Date(dueInput.value).toISOString() : null;
      await createTask({ title, priority: priority.get(), dueAt: due });
    },
  });
  setTimeout(() => titleInput.focus(), 60);
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
                render();
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
                  style: { width: 'auto', padding: '6px 12px', fontSize: '12px' },
                  onclick: () => respondMentorshipRequest(n.relatedId, n.id, true),
                },
                'Accept'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--ghost',
                  style: { width: 'auto', padding: '6px 12px', fontSize: '12px' },
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

function toastStack() {
  if (!state.toasts.length) return null;
  return h(
    'div',
    { class: 'gb-toast-stack', role: 'status', 'aria-live': 'polite' },
    state.toasts.map((t) =>
      h(
        'div',
        { class: 'gb-toast is-' + (t.kind || 'error') },
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
      )
    )
  );
}

function confirmDelete(message, onYes) {
  const body = h('div', { class: 'gb-form' }, h('p', { class: 'gb-confirm-text' }, message));
  openModal({
    title: 'Please confirm',
    body,
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
          class: 'gb-rem-del',
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
                fontSize: '18px',
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
    HabitSleepInsightCard
      ? h(
          'div',
          { style: { padding: '0 20px', marginTop: '12px' } },
          HabitSleepInsightCard({ habits: state.habits, wellness: state.wellness })
        )
      : null
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
    headerName: () =>
      'Hey, ' + (state.user && state.user.displayName ? state.user.displayName : 'Buddy') + ' 👋',
    render: () =>
      ScreenDashboard({
        features: (state.user && state.user.features) || null,
        tasks: state.tasks,
        toggleTask,
        reminders: calendarReminders(),
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
        level: (state.user && state.user.level) || 1,
        onAddTask: openAddTask,
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
    headerName: () => 'Report',
    render: () =>
      ScreenReport({
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
      }),
  },
  achievements: {
    headerLabel: () => 'Your badges',
    headerName: () => 'Achievements',
    render: () => ScreenAchievements(achievementProps()),
  },
  focus: {
    headerLabel: () => 'Deep work',
    headerName: () => 'Focus',
    render: () =>
      ScreenFocus({
        onFocusSession: (mode, durationSec) =>
          api('/api/focus/sessions', { method: 'POST', body: JSON.stringify({ mode, durationSec }) }),
        getFocusStats: () => api('/api/focus/stats'),
      }),
  },
  habits: {
    headerLabel: () => '',
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
        reminders: calendarReminders(),
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
      ScreenMentor({
        api: {
          get: () => api('/api/mentor/chat'),
          post: (text) =>
            api('/api/mentor/chat/messages', {
              method: 'POST',
              body: JSON.stringify({ content: text }),
            }),
          clear: () => api('/api/mentor/chat/messages', { method: 'DELETE' }),
        },
      }),
  },
  circle: {
    headerLabel: () => 'Grow together',
    headerName: () => 'Growth Circle',
    render: () =>
      ScreenCircle({
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
          join: (id) => api('/api/circles/' + encodeURIComponent(id) + '/join', { method: 'POST' }),
          listChallenges: (id) => api('/api/circles/' + encodeURIComponent(id) + '/challenges'),
          createChallenge: (id, body) =>
            api('/api/circles/' + encodeURIComponent(id) + '/challenges', {
              method: 'POST',
              body: JSON.stringify(body),
            }),
        },
      }),
  },
  family: {
    headerLabel: () => 'Cook for everyone',
    headerName: () => 'Family',
    render: () =>
      ScreenFamily({
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
            api('/api/family/shopping/' + encodeURIComponent(id) + '/toggle', { method: 'POST' }),
          deleteShopping: (id) =>
            api('/api/family/shopping/' + encodeURIComponent(id), { method: 'DELETE' }),
        },
      }),
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
      ScreenGoals({
        sections: state.goals,
        onCreateGoal: createGoal,
        onToggleGoal: toggleGoal,
        onDeleteGoal: deleteGoal,
        onAddAction: addGoalAction,
        onUpdateAction: updateGoalAction,
        onDeleteAction: deleteGoalAction,
        goalProgress: state.goalProgress || {},
        onUpdateGoalProgress: updateGoalProgress,
      }),
  },
};

/* ---- Render ---- */
const root = document.getElementById('root');
let renderedScreen = '';

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
    const msg = (payload && payload.message) || 'Request failed (' + res.status + ')';
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
      h('p', { class: 'gb-login-sub' }, subtitle),
      state.authNotice ? h('p', { class: 'gb-login-notice' }, state.authNotice) : null,
      children,
      state.error ? h('p', { class: 'gb-login-error' }, state.error) : null
    )
  );
}

function primaryBtn(label, onClick) {
  return h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary gb-login-btn',
      onclick: onClick,
      disabled: state.loading ? true : null,
    },
    state.loading ? 'Please wait…' : label
  );
}

function field(label, input) {
  return [h('label', { class: 'gb-login-label' }, label), input];
}

function runAuth(action) {
  state.loading = true;
  state.error = '';
  render();
  return action()
    .catch((err) => {
      // Surface auth/connection failures as a toast rather than an inline
      // line buried in the card.
      toastError(err, 'Something went wrong.');
    })
    .finally(() => {
      state.loading = false;
      render();
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
  });

  function submit() {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    if (!email) {
      emailInput.focus();
      return;
    }
    if (!password) {
      pwInput.focus();
      return;
    }
    runAuth(async () => {
      // Sign-in is a plain credential check: it never routes to the OTP/verify
      // screen and never sends email. Any failure (wrong credentials, or an
      // unverified account) surfaces as an error toast via runAuth.
      const user = await authPost('/api/auth/login', { email, password });
      state.user = user;
      saveSession(user, user.token);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    });
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
    ...field('Email', emailInput),
    ...field('Password', pwInput),
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
  });

  function submit() {
    const email = emailInput.value.trim();
    const displayName = nameInput.value.trim();
    const password = pwInput.value;
    if (!email) {
      emailInput.focus();
      return;
    }
    if (password.length < 8) {
      state.error = 'Password must be at least 8 characters.';
      render();
      pwInput.focus();
      return;
    }
    runAuth(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await authPost('/api/auth/signup', { email, password, displayName, timezone: tz });
      setAuthMode('verify', {
        email,
        notice: 'We sent a 6-digit code to ' + email + '. Enter it below to finish signing up.',
      });
    });
  }

  [emailInput, nameInput, pwInput].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    })
  );

  return authShell(
    'Create your account',
    'We’ll email you a 6-digit code to confirm your address.',
    [
      ...field('Email', emailInput),
      ...field('Name', nameInput),
      ...field('Password', pwInput),
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
    class: 'gb-input gb-login-input gb-otp-input',
    placeholder: '••••••',
    maxlength: 6,
  });
  function submit() {
    const otp = (otpInput.value || '').replace(/\D/g, '');
    if (otp.length !== 6) {
      otpInput.focus();
      state.error = 'Enter the 6-digit code (must be exactly 6 digits).';
      render();
      return;
    }
    runAuth(async () => {
      const user = await authPost('/api/auth/verify', { email: state.authEmail, otp });
      state.user = user;
      saveSession(user, user.token);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    });
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
      ...field('6-digit code', otpInput),
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
    if (!email) {
      emailInput.focus();
      return;
    }
    runAuth(async () => {
      await authPost('/api/auth/forgot-password', { email });
      setAuthMode('reset', {
        email,
        notice: 'If that email is registered, we just sent a 6-digit code to it.',
      });
    });
  }
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  return authShell('Reset password', 'Enter your email and we’ll send you a code.', [
    ...field('Email', emailInput),
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
    class: 'gb-input gb-login-input gb-otp-input',
    placeholder: '••••••',
    maxlength: 6,
  });
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'At least 8 characters',
    maxlength: 128,
  });
  function submit() {
    const otp = (otpInput.value || '').replace(/\D/g, '');
    if (otp.length !== 6) {
      otpInput.focus();
      state.error = 'Enter the 6-digit code.';
      render();
      return;
    }
    if (pwInput.value.length < 8) {
      pwInput.focus();
      state.error = 'Password must be at least 8 characters.';
      render();
      return;
    }
    runAuth(async () => {
      const user = await authPost('/api/auth/reset-password', {
        email: state.authEmail,
        otp,
        password: pwInput.value,
      });
      state.user = user;
      saveSession(user, user.token);
      state.wellness = loadWellness();
      state.goalProgress = loadGoalProgress();
      state.money = loadMoney();
      state.streakFreeze = loadStreakFreeze();
      state.trends = loadTrends();
      state.screen = 'home';
      history.replaceState(null, '', '#/home');
      await loadData();
    });
  }
  [otpInput, pwInput].forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    })
  );

  return authShell('Set a new password', 'Code sent to ' + state.authEmail + '.', [
    ...field('6-digit code', otpInput),
    ...field('New password', pwInput),
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
  state.googleEventsByMonth = {};
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
function loadingSplash() {
  return h(
    'div',
    { class: 'gb-splash', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'gb-splash-inner' },
      Logo({ size: 56 }),
      QuoteCard({ quote: state.quote }),
      h(
        'div',
        { class: 'gb-splash-loading', 'aria-label': 'Loading' },
        h('span', { class: 'gb-splash-dot' }),
        h('span', { class: 'gb-splash-dot' }),
        h('span', { class: 'gb-splash-dot' })
      )
    )
  );
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

/** A gentle prompt (weekend/Monday) to do the weekly review, once per week. */
function weeklyReviewNudge() {
  if (!weeklyReviewDue()) return null;
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

  // While the initial data load is in flight (e.g. a page reload), show the
  // quote-of-the-day splash instead of an empty dashboard.
  if (state.loading) {
    root.replaceChildren(loadingSplash());
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
      theme: state.theme,
      onAdd: openAddSheet,
      onTheme: toggleTheme,
      onAccount: toggleProfileOpen,
      unreadCount: unreadNotifs(),
      onBell: toggleNotifOpen,
    }),
    notificationDropdown(),
    profileDropdown(),
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
        : cfg.render()
    ),
    BottomNav({
      active: state.screen,
      onNav: setScreen,
      onMore: toggleMoreOpen,
      moreOpen: state.moreOpen,
      features: (state.user && state.user.features) || null,
      layout: (state.user && state.user.navLayout) || null,
    })
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
function installOutsideClickToCloseHeaderPopovers() {
  if (!state.notifOpen && !state.profileOpen) return;
  function cleanup() {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }
  function closePopovers() {
    cleanup();
    state.notifOpen = false;
    state.profileOpen = false;
    render();
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
        reconcileStreakFreeze();
        render();
      }
    })
    .catch((err) => console.warn('CacheStorage init failed:', err));
}
initA11y();
document.documentElement.setAttribute('data-theme', state.theme);
if (state.user) {
  // Restore the screen from the URL fragment, so refreshing on /circle stays there.
  state.screen = screenFromHash();
  loadData();
  
  // CRITICAL: Periodic sync of local-cached data to database every 5 minutes.
  // This ensures money/wellness data persists even if initial sync failed or connection dropped.
  setInterval(() => {
    if (!state.user) return; // Skip if logged out
    
    // Sync money data every 5 minutes
    if (state.money && (state.money.expenses || []).length > 0) {
      api('/api/money', { method: 'PUT', body: JSON.stringify(state.money) })
        .catch((err) => console.warn('⚠️ [5min sync] Money sync failed:', err));
    }
    
    // Sync wellness data every 5 minutes
    if (state.wellness && (Object.keys(state.wellness.sleepByDate || {}).length > 0 || 
                            Object.keys(state.wellness.moodByDate || {}).length > 0)) {
      api('/api/daily-logs', {
        method: 'PUT',
        body: JSON.stringify({
          sleepByDate: state.wellness.sleepByDate || {},
          moodByDate: state.wellness.moodByDate || {}
        })
      }).catch((err) => console.warn('⚠️ [5min sync] Wellness sync failed:', err));
    }
  }, 5 * 60 * 1000); // 5 minutes
}
render();
window.addEventListener('load', refreshIcons);
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);
// Coming back from another tab (often Google Calendar itself) — pull fresh
// events. The visibilitychange twin covers the mobile WebView, where returning
// from the system browser or app switcher doesn't fire window focus.
function refreshGoogleEventsOnReturn() {
  if (state.user) {
    loadGoogleEventsForMonth(state.calYear, state.calMonth, { force: true });
  }
}
window.addEventListener('focus', refreshGoogleEventsOnReturn);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshGoogleEventsOnReturn();
});
