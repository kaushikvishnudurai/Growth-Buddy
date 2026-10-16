/* =====================================================================
   Growth Buddy — App shell: state, routing, render
   ===================================================================== */
import {
  h,
  activate,
  AppHeader,
  BottomNav,
  refreshIcons,
  Icon,
  plural,
  IconChip,
  Check,
  CrashCard,
  Card,
  openOverlay,
  closeOverlays,
  trackOverlay,
  openModal as sharedModal,
  fieldRefusal,
  fieldError,
  shakeRefusal,
  landed,
  leave,
  formatTime,
  setTimeFormat,
  detectTimeFormat,
  setThinking,
  rovingGroup,
  focusSoon,
  SHEET_EXIT_MS,
  visibleText,
} from './gb-kit.js';
import { setLocale, localeFromUser, fmtDate } from './i18n.js';
import { BREAK_LENGTHS, breakState, startBreak, endBreak } from './break.js';
import { installCameraGate, cameraAskAgain } from './camera.js';
import { dateKey, parseWhen } from './dates.js'; // todayKey is the account's day, below
import {
  ScreenDashboard,
  ScreenFood,
  ScreenSummary,
  HabitSleepInsightCard,
  RenderMiniCalendarCard,
  QuoteCard,
  setAccountZone,
  resolveHomeLayout,
  sleepHours,
  StreakChain,
  loadOutlook,
} from './dashboard.js';
import { habitDue, todayKey as sharedTodayKey, shiftDayKey, tasksForToday, sortHabitsForHome, zoneMinutes } from './home-order.js';
import { withProgressLog, needsProgressLog } from './goal-milestones.js';
import { goalTaskStats, combinedGoalProgress, goalFinishedBy } from './goal-tasks.js';
import {
  overlayPendingWater,
  replayOldestFirst,
  summaryIsForToday,
  generation,
  applyWeekInvalidation,
  latestSeq,
  restoreKey,
  inFlightKeys,
  overlayQueuedWellness,
  networkError as isNetworkError,
  offlineError as isOfflineError,
  sameZone,
  firstRunSteps,
  pushAskDue,
  SAVED_ON_PHONE,
  savedLocallyMessage,
} from './app-logic.js';
import {
  MEAL_SLOTS,
  mealSlotAt,
  effectiveMl,
  labelFor,
  suggestWaterGoalMl,
  slotOf,
  cameraErrorMessage,
} from './nutrition.js';
import {
  daysFrom,
  linkedHabitActivity,
  monthStart,
} from './habit-stats.js';
// The Money document model only; the screen and its Customise pane are lazy
// (SCREENS.money, moneyPane), so money.js stays out of the boot chunk.
import {
  emptyMoney,
  normalizeMoney,
  ledgerDiff,
  applyLedgerDiff,
  docDiff,
  applyDocDiff,
  docPart,
  LEDGER_ARRAYS,
  suggestCategory,
  homeCur,
  fmtIn,
} from './money-core.js';
import { quickMoney, quickCategory, currencySymbol, intentDay, dayWord, stripEmoji, capitalise } from './quick-add.js';
import {
  ScreenCalendar,
  RenderCalendarToolbar,
  RenderCalendarSide,
  RenderCalendarGrid,
  resetCalendarForm,
  prefillCalendarReminder,
  isPastSlot,
  setRoutine,
  setDefaultLead,
  getDefaultLead,
  setReminderSettingsOpener,
  setCalendarImporter,
  setCustomToneAdder,
  setVoiceReminder,
  NotifySelect,
  UsualTimeChip,
  leadLabel,
  minutesLabel,
  REPEATS,
  REPEAT_ORDER,
  TAGS,
  clearReminderForm,
  openRoutineDialog,
} from './calendar.js';
import { setWorkWeek } from './recurrence.js';
import { computeAchievements, levelProgress } from './achievements.js';
import { celebrate } from './celebrate.js';
import { habitMoment, tasksMoment, waterMoment } from './moments.js';
import { openSnap } from './snap.js';
import {
  lastNightGuess,
  usualSleep,
  sleepFromHours,
  stepsTarget,
  focusMinutesTarget,
  HEALTH_LINKS,
} from './nudges.js';
import {
  enablePush,
  disablePush,
  pushSubscribed,
  pushSupported,
  syncDeviceAlarms,
  cancelAllAlarms,
  usualDrinkHours,
  WATER_DEFAULTS,
  WATER_ACTION_ML,
  notificationTarget,
  setToneSource,
} from './push.js';
import { CacheStorage } from './cache-storage.js';
import {
  sessionGen,
  bumpSession,
  isStaleSession,
  sessionEndedError,
  SESSION_ENDED,
  freshUserState,
  USER_CACHES,
  isUserKey,
  bootKey,
  bootSnapshot,
  readBootSnapshot,
  bootFromSnapshot,
} from './session.js';
import { createOutbox, tempId, isTempId, newIdemKey } from './outbox.js';
import {
  initNative,
  isNative,
  deviceLabelHeader,
  localNotificationsAvailable,
  localNotificationPermission,
  nativePlugin,
  applyNativeStatusBar,
  hideNativeSplash,
  readTodaySteps,
  readLastNight,
  readHealthValue,
  readHealthForSync,
  healthAvailable,
  requestHealthAccess,
  onLocalNotificationAction,
  setNativeAuth,
  clearNativeAuth,
  takeNativeChanges,
  onNativeChanges,
  onDeepLink,
  deepLinkHash,
  publicSiteUrl,
} from './native.js';
import { launchIntent } from './launch-intent.js';
import { registerSW } from 'virtual:pwa-register';
import { registerToast } from './toast.js';
import { createUndoQueue } from './undo-queue.js';
import { initA11y, focusLocator, refocus } from './a11y.js';
import { initErrorReporting } from './error-report.js';
import { initVitals, markHomePainted } from './vitals.js';
import {
  CUSTOM_MAX_BYTES,
  CUSTOM_MAX_COUNT,
  CUSTOM_MAX_MS,
  DEFAULT_CHIME,
  canRecordChime,
  customChimes,
  customKey,
  isKnownChime,
  playChime,
  readCustomChime,
  recordCustomChime,
  setCustomChimes,
} from './chime.js';

// Replaced by Vite's `define` at build time — see vite.config.js.
window.GB_BUILD = __GB_BUILD__;
console.log('[gb] build', __GB_BUILD__);

/* The service worker is for the website only. In the phone app the files are
   already on the device and reminders go through LocalNotifications, so all a
   worker did there was keep serving the previous build's precache after an APK
   update, until the app had been fully closed once or twice. The app removes any
   worker an older build left behind, and its caches, but not gb-store-v2 (the
   session lives there). */
if ('serviceWorker' in navigator) {
  if (isNative()) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (window.caches) {
      caches
        .keys()
        .then((keys) =>
          keys
            .filter((k) => k.startsWith('workbox-') || k === 'gb-chunks' || k === 'gb-api-get')
            .forEach((k) => caches.delete(k))
        )
        .catch(() => {});
    }
  } else if (!import.meta.env.DEV) {
    // vite-plugin-pwa emits sw.js only in a build; on the dev server it is the SPA fallback.
    initServiceWorker();
  }
}

/* A new deploy reaches an open tab or an installed app. The worker is
   registerType 'prompt' (vite.config.js): a new build installs and WAITS, and
   the page keeps the old build's precache, chunks and all, so nothing skews
   under it. "Reload" tells the waiting worker to take over and reloads once it
   has (registerSW's updateSW(true)). The worker is otherwise only re-checked on
   a navigation, which a hash-routed app never makes, so coming back to the app
   checks too. Dismissed, it asks again on the next return. */
function initServiceWorker() {
  let updateReady = false;
  const offerUpdate = () =>
    pushToast('A new version is ready.', 'info', 24 * 60 * 60 * 1000, {
      label: 'Reload',
      run: () => updateSW(true),
    });
  const updateSW = registerSW({
    onNeedRefresh() {
      updateReady = true;
      offerUpdate();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (updateReady) {
          if (!state.toasts.some((t) => t.message === 'A new version is ready.')) offerUpdate();
        } else reg.update().catch(() => {});
      });
    },
  });
}

// Prefer the build-time env (VITE_API_BASE). In dev, fall back to '' so requests
// are same-origin (relative) and flow through the Vite proxy to the backend.
// NOTE: no runtime (cookie-backed) override — a planted `gb.apiBase` cookie could
// otherwise redirect every API call, bearer token attached, to an attacker host.
// In dev only, still honor it for convenience.
const API_BASE = resolveApiBase();
// Crash reports → POST /api/client-errors → server log (scripts/error-report.js).
initErrorReporting({ apiBase: API_BASE, build: __GB_BUILD__, screen: () => state && state.screen });
// RUM: LCP/CLS/INP/TTFB + Home paint, 10% of prod loads → POST /api/client-vitals (scripts/vitals.js).
initVitals({ apiBase: API_BASE, build: __GB_BUILD__, screen: () => state && state.screen });

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

/* ---- App state ---- */
const THEME_KEY = 'gb.theme';
/* A picked theme wins; until there is one, the phone's setting decides, and
   keeps deciding when it flips at sunset (followSystemTheme). */
const systemDark =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
function pickedTheme() {
  try {
    const t = CacheStorage.getItem(THEME_KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch (_) {
    return null;
  }
}
function loadTheme() {
  return pickedTheme() || (systemDark && systemDark.matches ? 'dark' : 'light');
}
function followSystemTheme() {
  if (!systemDark || !systemDark.addEventListener) return;
  systemDark.addEventListener('change', () => {
    if (pickedTheme() || (state.user && state.user.uiPrefs && state.user.uiPrefs.theme)) return;
    state.theme = systemDark.matches ? 'dark' : 'light';
    // The theme is CSS on <html>: nothing to rebuild. A render() here emptied
    // the sign-in form being typed and closed Family's and Circle's open panels.
    applyTheme(state.theme);
  });
}

/* ---- Premium skin ----
   One attribute on <html> swaps the whole look; styles/premium.css is scoped
   to it. Nothing else in the app branches on this — keep it that way, a skin
   that needs JS forks is not a skin.
   The stylesheet loads on demand (it is 21 kB of render-blocking CSS that is
   inert for everyone with the toggle off), and the attribute only turns 'on'
   once it has: 'on' with the rules missing would paint the classic look and
   then jump. At boot, 'loading' hides #root (app.css) until then, so a reload
   with premium on never shows a classic frame. Precached like every chunk. */
const PREMIUM_KEY = 'gb.premium';
function loadPremium() {
  try {
    return CacheStorage.getItem(PREMIUM_KEY) === '1';
  } catch (_) {
    return false;
  }
}
let premiumCss = null;
let premiumCssReady = false;
function loadPremiumCss() {
  premiumCss =
    premiumCss ||
    import('../styles/premium.css').then(
      () => {
        premiumCssReady = true;
      },
      (err) => {
        premiumCss = null; // let the next toggle try again
        throw err;
      }
    );
  return premiumCss;
}
function applyPremium(on, hideUntilReady = false) {
  const el = document.documentElement;
  if (!on || premiumCssReady) {
    el.setAttribute('data-premium', on ? 'on' : 'off');
    return;
  }
  if (hideUntilReady) el.setAttribute('data-premium', 'loading');
  loadPremiumCss().then(
    () => applyPremium(state.premium),
    () => el.setAttribute('data-premium', 'off') // offline and never cached: classic, not blank
  );
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
  reportRange: 7, // days shown in the Report trends drill-down (7 | 30 | 90 | 365)
  water: null,
  food: null,
  quote: loadCachedQuote(),
  score: 0,
  // Auth flow: 'signin' | 'signup' | 'verify' | 'forgot' | 'reset' | 'totp' | 'deletion'
  // Restore a pending verify screen across reloads so a refresh doesn't strand
  // the user on sign-in (which then makes them re-signup and burn the code).
  authMode: loadAuthDraft().mode || 'signin',
  authEmail: loadAuthDraft().email || '',
  authNotice: '',
  // {email, password, cancelDeletion, message} between a right password and the
  // 2FA / cancel-deletion step (routeSignInStep). Memory only, never stored.
  authPending: null,
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
   default. The session cache carries uiPrefs and `gb.session`'s slim cookie keeps
   them (read synchronously at module init), so it is available here. hydrateUiPrefs()
   sets it again on every refresh; this is the same value, earlier. */
setWorkWeek(state.user && state.user.uiPrefs && state.user.uiPrefs.workWeek);
setRoutine(state.user && state.user.uiPrefs && state.user.uiPrefs.routine);
setDefaultLead(state.user && state.user.uiPrefs && state.user.uiPrefs.reminderLead);
setReminderSettingsOpener(() => openProfileSettings('reminders'));
setCalendarImporter(() => openIcsImportDialog());
setCustomToneAdder(() => openCustomToneDialog());
setVoiceReminder({ supported: () => voiceSupported(), capture: (btn) => captureReminder(btn) });
// The phone app asks for the camera again on every photo tap (camera.js).
installCameraGate();
// A focus session resumed before the first alarm sync still rings the user's tone.
setToneSource(() => notifySound());
setTimeFormat(state.user && state.user.uiPrefs && state.user.uiPrefs.timeFormat);
// i18n.js: dates/numbers format in this locale and <html lang> follows it (index.html
// ships lang="en"). No locale field on the profile yet → the device's language.
setLocale(localeFromUser(state.user));

let stomp = null;
let toastSeq = 0;

/* The toast stack is `position: fixed` and lives in its own stable slot, so it
   repaints without rebuilding the screen underneath — same reasoning as the
   header popovers. A toast that reloaded the page you were reading was the
   loudest possible way to say "saved". */
function paintToasts() {
  const slot = document.getElementById('gb-toast-slot');
  if (!slot) {
    render();
    return;
  }
  slot.replaceChildren(...[toastStack()].filter(Boolean));
  refreshIcons();
}

/* A dismissed toast plays its exit (.is-leaving, gb-toast-out in app.css)
   before it leaves state. The set, not a class on the node, so a render()
   during the exit keeps it leaving.
   `quiet`: the toast's own onGone is not run (its Undo was tapped, or its
   undo window already settled). The close button is not quiet: closing an
   Undo toast means "done", so its delete goes now. */
const TOAST_OUT_MS = 160;
const leavingToasts = new Set();
function dismissToast(id, quiet) {
  const gone = state.toasts.find((t) => t.id === id);
  if (leavingToasts.has(id) || !gone) return;
  leavingToasts.add(id);
  if (gone.onGone && !quiet) gone.onGone();
  paintToasts();
  setTimeout(() => {
    leavingToasts.delete(id);
    state.toasts = state.toasts.filter((t) => t.id !== id);
    dropStaleToastTimers();
    paintToasts();
  }, TOAST_OUT_MS);
}

/* A toast belongs to the screen it was said on: on a screen change the ones
   with no button go ("Task added." stood on the Habits tab under a second
   one). One said in the last second stays, since it is usually what the
   navigation is the result of ("Added 3 habits..." then Home).
   ponytail: an age cut-off, not a per-toast owner screen; a caller that
   navigates more than a second after its toast passes keepToasts. */
function clearScreenToasts() {
  const now = Date.now();
  state.toasts.forEach((t) => {
    if (!t.action && now - t.at > 1000) dismissToast(t.id);
  });
}

/* Toast timers live outside the toast objects so a pointer resting on the
   stack (or a tap on it, or focus inside it) can hold every toast until it
   leaves. A three-line error was gone before it could be read. */
const toastTimers = new Map(); // id -> { handle, due } running, or { left } held
let toastsHeld = false;
function armToast(id, ms) {
  const prev = toastTimers.get(id);
  if (prev) clearTimeout(prev.handle);
  if (toastsHeld) {
    toastTimers.set(id, { left: ms });
    return;
  }
  toastTimers.set(id, { handle: setTimeout(() => dismissToast(id), ms), due: Date.now() + ms });
}
function holdToasts() {
  if (toastsHeld) return;
  toastsHeld = true;
  undoQueue.hold(); // an Undo toast's delete waits with it
  const now = Date.now();
  for (const [id, t] of toastTimers) {
    clearTimeout(t.handle);
    toastTimers.set(id, { left: Math.max(0, t.due - now) });
  }
}
function releaseToasts() {
  if (!toastsHeld) return;
  toastsHeld = false;
  undoQueue.release();
  // A little time back after letting go, so it doesn't vanish the instant you look away.
  for (const [id, t] of toastTimers) armToast(id, Math.max(t.left, 1500));
}
function dropStaleToastTimers() {
  const live = new Set(state.toasts.map((t) => t.id));
  for (const [id, t] of toastTimers) {
    if (live.has(id)) continue;
    clearTimeout(t.handle);
    toastTimers.delete(id);
  }
  // The stack that was being hovered is gone, and with it any mouseleave.
  if (!state.toasts.length) {
    toastsHeld = false;
    undoQueue.release();
  }
}

/* How long an error stays: never under six seconds, longer the more there is
   to read, whatever shorter time the call site asked for. */
function errorToastMs(text) {
  return Math.min(12000, 6000 + text.length * 40);
}

/* Screen readers hear toasts through two regions that live outside the
   re-rendered tree: render() rebuilds the stack, and a rebuilt live region
   either repeats itself or says nothing. Errors go assertive. */
function announce(text, urgent) {
  const id = urgent ? 'gb-sr-alert' : 'gb-sr-status';
  let el = document.getElementById(id);
  if (!el) {
    el = h('div', {
      id,
      class: 'gb-sr-only',
      role: urgent ? 'alert' : 'status',
      'aria-live': urgent ? 'assertive' : 'polite',
    });
    document.body.append(el);
  }
  el.textContent = '';
  // Filled a beat later: a region filled in the same tick it was created is skipped.
  setTimeout(() => (el.textContent = text), 60);
}

/* Errors about the connection, not about anything typed: these are what
   coming back online makes untrue. */
const OFFLINE_ACTION = 'You’re offline, so that didn’t go through. Try again once you reconnect.';
function isConnectionToast(t) {
  return t.kind === 'error' && (t.message === NO_CONNECTION || t.message === OFFLINE_ACTION);
}

/* `action` ({label, run}) puts one button on the toast — a reminder's Snooze.
   Tapping it runs it and dismisses the toast. `durationMs: Infinity` arms no
   timer (an Undo toast: deferDelete's queue closes it). `opts.onGone` runs when
   the toast goes any other way than its button: closed, or pushed off the
   stack. `opts.icon` is its own glyph over TOAST_ICON's (notes: 'trash-2'). */
let lastError = { id: 0, text: '' }; // the newest error toast, so a caller can tell one was said
function pushToast(message, kind, durationMs, action, opts) {
  const onGone = (opts && opts.onGone) || null;
  let text = message || 'Something went wrong.';
  // A late answer for a session that has ended (session.js) has nobody to tell,
  // and "session expired" from the requests a 401 cut short is what the sign-in
  // card's notice already says.
  if (text === SESSION_ENDED || (text === SESSION_EXPIRED && !state.user)) return 0;
  // The banner already says the connection is down; repeating "Check your
  // internet" under it said it twice. What's left to say is what happened to
  // the thing just tried.
  if (text === NO_CONNECTION && !state.online) text = OFFLINE_ACTION;
  const toast = {
    id: ++toastSeq,
    message: text,
    kind: kind || 'error',
    at: Date.now(), // when it arrived — toastStack resumes its entrance from here
    action: action || null,
    onGone,
    icon: (opts && opts.icon) || null,
  };
  // Two "Task deleted." toasts are two Undos: only plain repeats collapse.
  const before = state.toasts;
  state.toasts = [...before.filter((t) => t.onGone || t.message !== text), toast].slice(-4);
  for (const t of before) if (t.onGone && !state.toasts.includes(t)) t.onGone();
  if (toast.kind === 'error') lastError = { id: toast.id, text };
  dropStaleToastTimers();
  paintToasts();
  announce(text, toast.kind === 'error');
  // Errors only. A nod has to mean "you got something done" — wiring it to
  // every success toast made it fire for "Changes saved" and even for the
  // skin toggle, which is feedback about nothing. The nod now lives on the
  // actual accomplishments (toggleTask / toggleHabit).
  if (toast.kind !== 'success' && toast.kind !== 'info') buddyReact('no');
  const asked = typeof durationMs === 'number' ? durationMs : 2800;
  if (Number.isFinite(asked))
    armToast(toast.id, toast.kind === 'error' ? Math.max(asked, errorToastMs(text)) : asked);
  return toast.id;
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
  return pushToast((err && err.message) || fallback || 'Something went wrong.', 'error');
}

/* Quick add applies several trackers at once and says it in one summary
   toast; each saver's own "Sleep saved." on top of it read as two answers.
   ponytail: a counter, not a flag per saver; it also hushes an unrelated
   success that lands during the apply (errors still show). Per-call `quiet`
   options if that ever matters. */
let quietSuccess = 0;
function toastSuccess(message, opts) {
  if (quietSuccess) return;
  pushToast(message, 'success', 1800, null, opts);
}

// Hand the real implementations to the late-bound bridge that screens import.
registerToast({
  success: toastSuccess,
  error: toastError,
  dismiss: dismissToast,
  // A toast with one button (e.g. "Undo") — the same action slot a reminder's Snooze uses.
  // `opts.icon` swaps the kind's glyph ('trash-2' on "Note deleted.").
  action: (message, label, run, opts) => pushToast(message, 'info', 6000, { label, run }, opts),
  // Screen-reader-only status, for async results a repaint would otherwise swallow.
  announce,
});

/* ---- Deferred deletes (scripts/undo-queue.js) ----
   Undo instead of "Are you sure?": the item leaves the screen at once, a toast
   says so with Undo, and the DELETE goes only when the toast's window passes
   (held, like every toast, while the stack is hovered or focused). Undo puts it
   back where it was. Page hidden or sign-out sends what is pending first; a
   send that fails puts the item back and toasts. Each delete is its own toast,
   so several pending ones are undone separately.
   `remove` / `restore` change state only, and `remove` must be safe to run
   again: render() and overlayOutbox() re-run it, so a list reloaded from the
   server mid-window doesn't bring the item back. `commit` is the real request,
   through api() and, offline, the outbox: the same paths the old instant
   delete used. */
const UNDO_MS = 6000;
const undoQueue = createUndoQueue({ ms: UNDO_MS, onError: (err, e) => toastError(err, e.errorText) });

function deferDelete({ message, errorText, remove, restore, commit, selector, afterRemove, paint = render }) {
  const uid = state.user && state.user.id;
  const mine = () => !!state.user && state.user.id === uid;
  let toastId = 0;
  const qid = undoQueue.schedule({
    errorText,
    remove,
    restore: () => {
      if (!mine()) return; // signed out meanwhile: there is no list to put it in
      restore();
      paint();
      if (selector) landSoon(selector);
    },
    commit,
    settled: () => dismissToast(toastId, true),
  });
  toastId = pushToast(
    message,
    'info',
    Infinity,
    { label: 'Undo', run: () => undoQueue.undo(qid) },
    { onGone: () => undoQueue.commit(qid) }
  );
  // A row with an exit animation plays it; anything else just repaints.
  if (selector) removeSoon(selector, afterRemove || (() => {}));
  else paint();
}

/* remove / restore for an item of an id-keyed list held at get() / set(). */
function listSlot(get, set, id) {
  let item = null;
  let at = 0;
  return {
    remove() {
      const list = get() || [];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      item = list[i];
      at = i;
      set(list.filter((x) => x.id !== id));
    },
    restore() {
      const list = get() || [];
      if (!item || list.some((x) => x.id === id)) return;
      set([...list.slice(0, at), item, ...list.slice(at)]);
    },
  };
}

// Pending deletes go before the page does. pagehide alone misses a phone
// that backgrounds the tab and never comes back to it.
const flushDeletes = () => undoQueue.flush();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushDeletes();
});
window.addEventListener('pagehide', flushDeletes);

function score() {
  if (state.score > 0) {
    return state.score;
  }
  let sum = 0,
    parts = 0;
  // Today's tasks only: tomorrow's and undated ones are not today's miss.
  // Same rule as Home's score card (home-order.js): due by tonight, overdue, or done today.
  const tasks = tasksForToday(state.tasks, new Date(), state.user && state.user.timezone);
  if (tasks.length) {
    sum += tasks.filter((t) => t.done).length / tasks.length;
    parts++;
  }
  // Only the habits owed today, as on the server (HabitService.countsOn): a
  // weekly habit already done this week is not today's miss. Habits switched
  // off count as none, as on the server (ScoreService).
  const due = featureOn('habits') ? state.habits.filter(habitDueToday) : [];
  if (due.length) {
    sum += due.filter((h) => h.doneToday).length / due.length;
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
  setNativeAuth(token || loadToken(), API_BASE); // notification buttons, app closed
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
    console.error('Failed to cache wellness data locally:', err);
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
    console.error('Failed to cache goal progress locally:', err);
  }
  // Note: Goal progress is already persisted via updateGoalProgress() API calls.
  // This is just a local cache for offline access.
}

/* Per goal: which save is the newest. Each PUT carries the whole merged blob,
   so only the newest one's failure is worth rolling back — an older one's is
   already superseded by whatever was sent after it. */
const goalProgressSeq = latestSeq();
const goalSaves = new Map(); // goal key -> the tail of its save chain
const goalUnsent = new Set(); // goal keys with an edit no PUT has carried yet

/* Leaving (reload, tab closed) while an edit waits behind a save in flight:
   send the newest blob now, keepalive, so the chain's wait cannot lose it.
   No If-Match: it is the newest copy, and the queued save would have won. */
window.addEventListener('pagehide', () => {
  goalUnsent.forEach((key) =>
    api('/api/goals/' + encodeURIComponent(key) + '/progress', {
      method: 'PUT',
      keepalive: true,
      body: JSON.stringify(state.goalProgress[key]),
    }).catch(() => {})
  );
  goalUnsent.clear();
});

/* One progress PUT (goal-merge.js putProgress: If-Match, and on a 409 this
   tab's edits put onto the server's copy and sent once more). Lazy: the
   merge is off the boot chunk, and the import is cached after the first save. */
async function putGoalProgress(goalId, key) {
  const goal = (state.goals || []).flatMap((sec) => sec.goals || []).find((g) => String(g.id) === key);
  const { putProgress } = await import('./goal-merge.js');
  const read = () => {
    goalUnsent.delete(key);
    return state.goalProgress[key];
  };
  return putProgress(api, goalId, goal, read, (blob) => {
    state.goalProgress[key] = blob;
    persistGoalProgress();
    render();
  });
}

function updateGoalProgress(goalId, patch) {
  if (!state.goalProgress) state.goalProgress = {};
  const key = String(goalId);
  const prev = state.goalProgress[key];
  const seq = goalProgressSeq.start(key);
  // Every save also dates today's percentage (`progressLog`, one per day, last
  // wins): it is the history insights.js `goalPace` fits its finish date to.
  state.goalProgress[key] = withProgressLog(
    Object.assign({}, prev || {}, patch),
    accountTodayKey()
  );
  persistGoalProgress();
  render();
  // Optimistic, but not silent: a failure used to be a console line only, so
  // the tick stayed on screen and was gone after the next reload.
  // Chained per goal: two saves in flight landed out of order and the older
  // blob won (HOS-3). Each sends what the tab holds when its turn comes.
  goalUnsent.add(key);
  const run = (goalSaves.get(key) || Promise.resolve()).then(() => putGoalProgress(goalId, key));
  goalSaves.set(key, run.catch(() => {}));
  run.catch((err) => {
    if (!goalProgressSeq.isLatest(key, seq)) return;
    restoreKey(state.goalProgress, key, prev);
    persistGoalProgress();
    render();
    toastError(err, 'Could not save that progress.');
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
    console.error('Failed to cache money data locally:', err);
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

/* Ledger writes (expenses / income / transfers) not yet confirmed by the server,
   by id — the newest change to an item wins. Mirrored to storage, so an expense
   added offline, or in a tab closed mid-save, is replayed on the next launch
   instead of lost. */
function pendingKey() {
  return moneyStorageKey(state.user) + '.pending';
}
function loadPendingLedger() {
  try {
    const p = JSON.parse(CacheStorage.getItem(pendingKey()) || 'null');
    if (p && p.upserts && Array.isArray(p.deletes)) return p;
  } catch (_) {
    /* unreadable → nothing pending */
  }
  return { upserts: {}, deletes: [] };
}
function storePendingLedger(p) {
  try {
    CacheStorage.setItem(pendingKey(), JSON.stringify(p));
  } catch (err) {
    console.error('Failed to keep unsaved money changes:', err);
  }
}
function queueLedger(diff) {
  if (!diff.upserts.length && !diff.deletes.length) return;
  const p = loadPendingLedger();
  const del = new Set(p.deletes);
  for (const u of diff.upserts) {
    p.upserts[u.id] = u;
    del.delete(u.id);
  }
  for (const id of diff.deletes) {
    delete p.upserts[id];
    del.add(id);
  }
  p.deletes = [...del];
  // New content, new request: a retry of the OLD batch could be answered from
  // the server's replay cache with a body that no longer matches what is sent.
  p.idemKey = newIdemKey();
  storePendingLedger(p);
}
/* Pending changes laid over a copy that came from the server, so a reload never
   shows an unsaved expense as gone, nor a deleted one as back. */
function overlayPending(money) {
  const p = loadPendingLedger();
  return applyLedgerDiff(money, { upserts: Object.values(p.upserts), deletes: p.deletes });
}

/* The document's twin of the queue above: docDiff ops (money-core.js) the server
   has not accepted yet. A loan repayment, a goal contribution or a bill marked
   paid offline used to be replaced by the server's copy at the next load, after
   "will sync" was promised. Now the server's copy is taken with these laid over
   it, and re-sent. */
function docPendingKey() {
  return moneyStorageKey(state.user) + '.docPending';
}
function loadPendingDoc() {
  try {
    const p = JSON.parse(CacheStorage.getItem(docPendingKey()) || 'null');
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  } catch (_) {
    /* unreadable → nothing pending */
  }
  return {};
}
function storePendingDoc(p) {
  try {
    if (Object.keys(p).length) CacheStorage.setItem(docPendingKey(), JSON.stringify(p));
    else CacheStorage.removeItem(docPendingKey());
  } catch (err) {
    console.error('Failed to keep unsaved money changes:', err);
  }
}
/* For the CSV import, between batches: true once nothing is left unsent. Bound
   to the session the Money screen was built in, so an import running over a
   sign-out stops instead of saving the rest into the next account's money. */
function moneySettledFor(gen) {
  return () =>
    moneySaveQueue.then(() => {
      if (isStaleSession(gen)) return false;
      const p = loadPendingLedger();
      return !Object.keys(p.upserts).length && !p.deletes.length;
    });
}

/* Drop the ops in `sent` that are still exactly as sent: the server has them. */
function clearPendingDoc(sent) {
  const now = loadPendingDoc();
  for (const [k, op] of Object.entries(sent))
    if (JSON.stringify(now[k]) === JSON.stringify(op)) delete now[k];
  storePendingDoc(now);
}
/* A copy fresh from the server becomes the live state with everything not yet
   accepted laid over it: ledger rows, then document ops. */
function adoptServerMoney(theirs) {
  state.money = normalizeMoney(applyDocDiff(overlayPending(theirs), loadPendingDoc()));
  lastDocBody = JSON.stringify(docPart(normalizeMoney(theirs)));
}

/* What the server last accepted of the document part, so an unchanged document
   (the usual case: most saves are one new expense) is not re-sent at all. */
let lastDocBody = null;

function saveMoney(next, base) {
  // Optimistic: update local + cache + repaint immediately, then persist to the
  // server (mirrors saveHomeLayout). Offline writes still land in the cache.
  //
  // `next` is built from the caller's own snapshot (`base`), which can be older
  // than the live state: an expense from another device or a WhatsApp payment
  // may have arrived since. Diffing against the live state turned every such
  // item into a delete. So: diff against the snapshot, then lay only that change
  // onto the live state. Balances are always the live ones; they come only from
  // the server.
  const nextN = normalizeMoney(next);
  const baseN = base ? normalizeMoney(base) : state.money;
  const diff = ledgerDiff(baseN, nextN);
  // The document the same way: only the keys and items this save changed. Laying
  // the snapshot's whole document over the live one lost a goal that arrived
  // from the laptop while Home's "Add expense" was open.
  const ops = docDiff(baseN, nextN);
  const had = new Set(((state.money && state.money.expenses) || []).map((e) => e.id));
  // A new expense for today (not a posted monthly repeat) ticks "Log every expense".
  if (diff.upserts.some((u) => u.kind === 'expense' && u.date === accountTodayKey() && !had.has(u.id) && !String(u.id).startsWith('rec-')))
    autoTickExpenseHabits();
  state.money = normalizeMoney(
    Object.assign(applyDocDiff(applyLedgerDiff(state.money, diff), ops), {
      accounts: state.money.accounts,
    })
  );
  queueLedger(diff);
  if (Object.keys(ops).length) storePendingDoc(Object.assign(loadPendingDoc(), ops));
  cacheMoney();
  render();
  persistMoney();
}

/* Queued: pending ledger writes, then the document if it changed. The 5-minute
   re-push below goes through here too; it used to PUT the whole document with
   no If-Match, silently replacing what another device — or a WhatsApp "Mark as
   paid" — had saved since. */
function persistMoney() {
  // CRITICAL: This MUST reach the database. Log all failures prominently.
  moneySaveQueue = moneySaveQueue.then(() =>
    flushLedger()
      .then(putDocIfChanged)
      .catch((err) => {
      if (err && err.sessionEnded) return; // signed out meanwhile: what is queued stays in that account's cache
      console.error('CRITICAL: saveMoney failed to reach database:', err);
      // No connection (or a server that's down) is not "not saved": the change is
      // in the cache and the ledger queue, and is replayed on the next flush
      // (handleOnline → loadData, or the timer below). Saying "not saved" made
      // people enter it twice. Only a refusal is worth an error; what flushLedger
      // keeps for a retry (RETRYABLE: 401, 408, 409, 429) is queued too.
      const queued =
        !navigator.onLine || !err || !err.status || err.status >= 500 || RETRYABLE.has(err.status);
      if (queued) pushToast(savedLocallyMessage(err, navigator.onLine), 'info');
      else toastError(err, 'Money changes were not saved. Check your connection and try again.');
    })
  );
}

/* Anything the server hasn't confirmed yet: queued ledger writes, or a document
   that differs from the last one it accepted. The 5-minute re-push asks this
   first, so an idle tab doesn't re-send (or re-toast) on a timer. */
function moneyDirty() {
  const p = loadPendingLedger();
  if (Object.keys(p.upserts).length || p.deletes.length) return true;
  return JSON.stringify(docPart(state.money)) !== lastDocBody; // null: the boot load failed
}

/* Put these items back to what the server holds: its copy, or gone if it has
   none. A refused save used to stay in the list and the totals until a reload
   showed it had never landed. Only these ids: the rest of the live state may
   hold changes still on their way. */
async function rollbackMoneyItems(ids) {
  if (!ids.length) return;
  const keep = new Set(ids);
  const only = (m) => {
    const out = {};
    for (const arr of Object.keys(LEDGER_ARRAYS))
      out[arr] = ((m && m[arr]) || []).filter((x) => x && keep.has(x.id));
    return out;
  };
  const theirs = normalizeMoney(await api('/api/money'));
  state.money = normalizeMoney(
    overlayPending(applyLedgerDiff(state.money, ledgerDiff(only(state.money), only(theirs))))
  );
  cacheMoney();
  render();
}

/* 4xx other than these is the server saying no to the content, which no retry
   will change; anything else (offline, 5xx, rate limit) stays queued. */
const RETRYABLE = new Set([401, 408, 409, 429]);

async function flushLedger() {
  const p = loadPendingLedger();
  const upserts = Object.values(p.upserts);
  if (!upserts.length && !p.deletes.length) return;
  // Stable while the batch is unchanged (queueLedger mints a new one when it
  // changes), so a POST that landed but whose answer was lost is replayed by the
  // server rather than applied twice.
  if (!p.idemKey) {
    p.idemKey = newIdemKey();
    storePendingLedger(p);
  }
  const idemKey = p.idemKey;
  let res;
  try {
    res = await api('/api/money/tx', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey },
      body: JSON.stringify({ upserts, deletes: p.deletes }),
    });
  } catch (err) {
    if (!err || !err.status || err.status >= 500 || RETRYABLE.has(err.status)) throw err;
    res = { rejected: upserts.map((u) => ({ id: u.id, reason: err.message })) };
    p.deletes.forEach((id) => res.rejected.push({ id, reason: err.message }));
  }
  // Clear only what this request carried: an edit made while it was in flight
  // is a newer version of the item and must still go.
  const now = loadPendingLedger();
  for (const u of upserts)
    if (JSON.stringify(now.upserts[u.id]) === JSON.stringify(u)) delete now.upserts[u.id];
  const sent = new Set(p.deletes);
  now.deletes = now.deletes.filter((id) => !sent.has(id));
  if (now.idemKey === idemKey) delete now.idemKey; // spent; anything left is a new batch
  storePendingLedger(now);
  // Refused entries are cleared with the rest — kept, they would fail every save
  // after them — and named, so nothing disappears without a word.
  if (res && res.rejected && res.rejected.length) {
    const r = res.rejected[0];
    toastError(
      null,
      res.rejected.length === 1
        ? 'One entry was not saved: ' + r.reason
        : res.rejected.length + ' entries were not saved. First: ' + r.reason
    );
    await rollbackMoneyItems(res.rejected.map((x) => x.id)).catch((err) =>
      console.error('Could not reload money after a refused save:', err)
    );
  }
  applyAccounts(res && res.accounts);
}

/* Behind the save queue: "cash is 1,850 right now" is worked out on the server
   from the rows it has, so an expense still in flight would skew it. */
function accountRequest(method, path, body) {
  const run = moneySaveQueue
    .then(flushLedger)
    .then(() =>
      api('/api/money/accounts' + path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      })
    )
    .then(applyAccounts);
  // A failed account write must not poison every later save in the queue.
  moneySaveQueue = run.catch(() => {});
  return run;
}

/* Balances only change on the server, so they arrive after the save. */
function applyAccounts(accounts) {
  if (!Array.isArray(accounts)) return;
  if (JSON.stringify(accounts) === JSON.stringify(state.money.accounts)) return;
  state.money = Object.assign({}, state.money, { accounts });
  cacheMoney();
  render();
}

async function putDocIfChanged() {
  const body = JSON.stringify(docPart(state.money));
  const sent = loadPendingDoc();
  if (body === lastDocBody) return clearPendingDoc(sent); // the server already holds it
  try {
    // No version yet means the boot load failed: a PUT now would be blind and
    // overwrite whatever another device saved. Treat it like a conflict: load,
    // merge, then write.
    if (!moneyVersion) throw { status: 409 };
    await putMoney(body, moneyVersion);
    lastDocBody = body;
    clearPendingDoc(sent);
  } catch (err) {
    if (!err || err.status !== 409) {
      // A refusal won't change on a resend: stop resending (and re-toasting) it.
      // A retryable status keeps it for the next try.
      if (err && err.status >= 400 && err.status < 500 && !RETRYABLE.has(err.status))
        clearPendingDoc(sent);
      throw err;
    }
    // Someone else wrote first. Take their copy, lay what we changed over it, and
    // write once more — unconditionally, so a third writer can't spin this. (A
    // union by id here kept their version of any item we had edited, and brought
    // back a cleared budget or a deleted tag.)
    const theirs = await api('/api/money', { onResponse: rememberMoneyVersion });
    const ops = loadPendingDoc();
    adoptServerMoney(theirs);
    cacheMoney();
    render();
    toastSuccess('Merged money changes from your other device.');
    const merged = JSON.stringify(docPart(state.money));
    await putMoney(merged, null);
    lastDocBody = merged;
    clearPendingDoc(ops);
  }
}

/* ---- UI preferences (theme, quick-add language, onboarding-dismissed,
   celebrated achievements) — persisted server-side on the user row via
   PUT /api/auth/ui-prefs, with the existing per-key CacheStorage entries kept
   as a synchronous mirror for the views that read them. The DB is the source
   of truth so these follow the user across devices; the cache is just the fast
   local read path. ponytail: one JSON blob + mirror, exactly like saveMoney. */
/* Patches whose PUT hasn't answered yet, laid over any /me that lands first
   (syncUserSession): refreshCurrentUser runs after every task or habit tick, and
   an answer read before the PUT committed flipped the pref back here. */
const uiPrefsInFlight = new Map();
let uiPrefsSeq = 0;

/* Keys whose save found no connection, per account: resent in one PUT, at their
   current values, once back online. Not an error, and no toast. */
let uiPrefsOffline = null;
/* Also run by handleOnline: a fetch can fail while navigator.onLine stays true,
   no 'online' event comes, and the /me that loadData reads reverted the prefs. */
function replayUiPrefsOffline() {
  const off = uiPrefsOffline;
  uiPrefsOffline = null;
  const prefs = state.user && state.user.uiPrefs;
  if (!off || !prefs || state.user.id !== off.uid) return;
  saveUiPrefs(Object.fromEntries([...off.keys].map((k) => [k, prefs[k]])), { quiet: true });
}
window.addEventListener('online', replayUiPrefsOffline);

/* Sends only `patch`: the server merges key by key (AuthService.updateUiPrefs).
   Sending the whole blob let a tab open since yesterday write its old copy of
   every other key over what another device had saved since. `quiet`: a write
   the app makes on its own (a baseline, a detected default), not worth a toast. */
function saveUiPrefs(patch, { quiet = false } = {}) {
  if (!state.user || !patch) return;
  state.user.uiPrefs = Object.assign({}, state.user.uiPrefs || {}, patch);
  // Mirror into the cached session too. That cache is what the app boots from,
  // and it was only ever refreshed by /api/auth/me — so a pref saved here read
  // back at its OLD value on the next reload, until some later request happened
  // to refresh the user. Caught by the working week, where a stale value means
  // the calendar draws the wrong days; it was equally wrong for the rest.
  saveSession(state.user, state.user.token);
  // Returned so a caller that reads the pref back server-side (the focus goal's streak) can wait for it.
  // keepalive: a reload right after a pref change (sign-in, theme) would
  // otherwise cancel the PUT. A patch is a few hundred bytes, far under 64 KB.
  const seq = ++uiPrefsSeq;
  uiPrefsInFlight.set(seq, patch);
  return api('/api/auth/ui-prefs', {
    method: 'PUT',
    keepalive: true,
    body: JSON.stringify({ prefs: patch }),
  })
    .catch((err) => {
      // The page is going (Firefox rejects the promise before it tears down): keepalive carries the PUT.
      if (document.visibilityState === 'hidden') return;
      if (err && err.message === NO_CONNECTION) {
        const uid = state.user && state.user.id;
        if (!uiPrefsOffline || uiPrefsOffline.uid !== uid) uiPrefsOffline = { uid, keys: new Set() };
        Object.keys(patch).forEach((k) => uiPrefsOffline.keys.add(k));
        return;
      }
      console.error('saveUiPrefs failed to reach database:', err);
      // The change shows on this device and would quietly undo itself on the next
      // sign-in. Offline is the banner's to say; a 401 signs out on its own.
      if (!quiet && navigator.onLine && !(err && err.status === 401)) {
        toastError(null, "Couldn't save that setting. It applies here, but may not on your next sign-in.");
      }
    })
    .finally(() => uiPrefsInFlight.delete(seq));
}

/* Which chime a notification makes in the app. Lives in ui_prefs like every
   other preference, so it follows the user to their next device. */
/* The tone a single notification should make. A reminder carrying its own
   chime rings with that one — `relatedId` is the reminder it came from — and
   everything else falls back to the one setting in Alerts. A reminder whose
   tone key we don't recognise falls back too: playChime() is silent on an
   unknown key, and a silent reminder is the one outcome nobody chose. A habit
   reminder's `relatedId` is the habit it came from (see
   HabitReminderDeliveryScheduler.deliver) and carries its own chosen tone the
   same way. */
function notifySoundFor(n) {
  if (n && n.kind === 'reminder' && n.relatedId) {
    const rem = (state.reminders || []).find((r) => r.id === n.relatedId);
    if (rem && rem.sound && isKnownChime(rem.sound)) return rem.sound;
  }
  if (n && n.kind === 'habit_reminder' && n.relatedId) {
    const habit = (state.habits || []).find((h) => h.id === n.relatedId);
    if (habit && habit.sound && isKnownChime(habit.sound)) return habit.sound;
  }
  return notifySound();
}

function notifySound() {
  const p = state.user && state.user.uiPrefs;
  return p && p.notifySound ? p.notifySound : DEFAULT_CHIME;
}

/* The user's own sounds (uploads and voice recordings, up to CUSTOM_MAX_COUNT),
   as data URLs. Deliberately NOT in ui_prefs: those blobs would ride along with
   every /api/auth/me. They live in two places instead — this device's
   CacheStorage, which is the copy that actually plays (instant, and fine with
   no connection), and the account, which is the only reason a second device
   can find them at all.
   Two kinds of key: a small index, [{ id, name, updatedAt, synced }], and each
   sound's bytes under its own key. Split because every setItem rewrites the
   whole value into the Cache API — kept as one list, marking a sound synced
   re-wrote up to four files' worth of base64 (~1.6 MB) to flip one flag.
   `synced` is false until the server has the sound, which is how a pull tells
   "never reached the server, upload it" from "deleted on another device, drop it". */
const CUSTOM_CHIMES_KEY = 'gb.notifySounds';
const customChimeBytesKey = (id) => 'gb.notifySound.' + id;
/* The one-sound keys from before. Read by nothing now; the pull fetches that
   sound back as the account's first. */
const LEGACY_CHIME_KEYS = ['gb.notifySoundFile', 'gb.notifySoundFileAt'];

function readChimeIndex() {
  try {
    const list = JSON.parse(CacheStorage.getItem(CUSTOM_CHIMES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && s.id) : [];
  } catch (_) {
    return [];
  }
}

/* The index with each sound's bytes attached. A row whose bytes are missing is
   left out: there is nothing to play, and the next pull fetches it again. */
function readCustomChimes() {
  return readChimeIndex()
    .map((s) => Object.assign({}, s, { dataUrl: CacheStorage.getItem(customChimeBytesKey(s.id)) }))
    .filter((s) => s.dataUrl);
}

/* Resolves once this device's copies have been read from the Cache API. The
   pull waits on it: merged against a list that hasn't loaded yet, a sound never
   uploaded looks like one deleted elsewhere, and would be dropped. */
let markCustomChimesLoaded;
const customChimesLoaded = new Promise((resolve) => (markCustomChimesLoaded = resolve));

function loadCustomChime() {
  LEGACY_CHIME_KEYS.forEach((k) => CacheStorage.removeItem(k));
  setCustomChimes(readCustomChimes());
  markCustomChimesLoaded();
  // A cold-start sync can run before the sounds are read; it queued own-sound
  // alarms on the default channel until the next re-sync.
  reSyncDeviceAlarms();
}

/* This device's copy. Synchronous and can't fail, which is why the picker
   writes here first and talks to the server afterwards. Bytes are written only
   when they changed, and dropped for any sound that left the list. */
function storeCustomChimes(list) {
  list = list || [];
  const keep = new Set(list.map((s) => s.id));
  readChimeIndex().forEach((s) => {
    if (!keep.has(s.id)) CacheStorage.removeItem(customChimeBytesKey(s.id));
  });
  list.forEach((s) => {
    const k = customChimeBytesKey(s.id);
    if (s.dataUrl && CacheStorage.getItem(k) !== s.dataUrl) CacheStorage.setItem(k, s.dataUrl);
  });
  const index = list.map(({ id, name, source, updatedAt, synced }) => ({
    id,
    name,
    source: source || null,
    updatedAt,
    synced: !!synced,
  }));
  if (index.length) CacheStorage.setItem(CUSTOM_CHIMES_KEY, JSON.stringify(index));
  else CacheStorage.removeItem(CUSTOM_CHIMES_KEY);
  setCustomChimes(list);
  // On a phone each of these sounds is a notification channel: a new one needs
  // building, a deleted one's channel removing (push.js syncNow does both).
  reSyncDeviceAlarms();
}

/* The server takes the client's id, so a retried upload replaces rather than
   filling a second slot. */
function newSoundId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

/* The account's copy of one sound. Throws if it doesn't land; this device keeps
   playing its own copy either way, so the caller's job is to say what hasn't
   happened, not to undo anything. On success only the index is rewritten. */
async function uploadCustomChime(sound) {
  const res = await api('/api/notifications/custom-sounds/' + sound.id, {
    method: 'PUT',
    body: JSON.stringify({ name: sound.name, source: sound.source, dataUrl: sound.dataUrl }),
  });
  storeCustomChimes(
    readCustomChimes().map((s) =>
      s.id === sound.id
        ? Object.assign({}, s, { synced: true, updatedAt: (res && res.updatedAt) || s.updatedAt })
        : s
    )
  );
}

/* Once per app load, not once per syncUserSession: that runs on every profile
   save and password change too, and re-checking the sounds each time a display
   name changes is traffic for files that can only have changed on another device. */
let customChimePulled = false;

/* On login: the account's list is the truth for every sound the server has
   seen, so one deleted on another device goes here too. The list carries no
   bytes; only the sounds this device lacks (or holds an older copy of) are
   fetched, all at once. A sound that never reached the server is uploaded now
   instead of dropped. Silent on failure — a device keeps playing what it has,
   which is exactly what happened before any of this synced. */
async function pullCustomChime() {
  if (customChimePulled) return;
  customChimePulled = true;
  await customChimesLoaded;
  if (!state.user) return; // signed out while the cache loaded
  try {
    const remote = (await api('/api/notifications/custom-sounds')) || [];
    const local = readCustomChimes();
    const byId = new Map(local.map((s) => [s.id, s]));
    const next = await Promise.all(
      remote.map(async (r) => {
        const mine = byId.get(r.id);
        if (mine && Date.parse(mine.updatedAt) >= Date.parse(r.updatedAt)) {
          return Object.assign({}, mine, { name: r.name, source: r.source || mine.source, synced: true });
        }
        const full = await api('/api/notifications/custom-sounds/' + r.id).catch(() => null);
        if (full && full.dataUrl) {
          return {
            id: r.id,
            name: full.name,
            source: full.source || null,
            dataUrl: full.dataUrl,
            updatedAt: full.updatedAt,
            synced: true,
          };
        }
        // Couldn't fetch it this time: keep an older copy rather than lose it.
        return mine ? Object.assign({}, mine, { synced: true }) : null;
      })
    );
    const have = next.filter(Boolean);
    const unsent = local.filter((s) => !s.synced && !remote.some((r) => r.id === s.id));
    const merged = have.concat(unsent).slice(0, CUSTOM_MAX_COUNT);
    const sig = (list) => list.map((s) => s.id + '@' + s.updatedAt + ':' + s.name).join('|');
    if (sig(merged) !== sig(local)) {
      storeCustomChimes(merged);
      // The pickers list them, so repaint — only when something actually changed.
      render();
    }
    for (const s of unsent.slice(0, Math.max(0, CUSTOM_MAX_COUNT - have.length))) {
      await uploadCustomChime(s).catch(() => {});
    }
  } catch (_) {
    /* offline, or signed out mid-flight — the local copies, if any, still play */
  }
}

/* On login / user refresh, mirror the server's stored UI prefs into the local
   cache keys the views read synchronously, so a fresh device paints the user's
   real theme/onboarding/etc. instead of defaults.
   `fromServer`: these prefs are the server's answer, so a theme, text size or
   premium key it lacks means the default (System, normal, off) — not whatever
   the last account left in this device's cookies. Only then: a patch without
   uiPrefs leaves state.user's older copy, which may be a slim cookie's. */
function hydrateUiPrefs(fromServer) {
  // A new account's row has none yet (null): that answer is all defaults too.
  const p = (state.user && state.user.uiPrefs) || (fromServer ? {} : null);
  if (!p) return;
  try {
    if (p.theme === 'dark' || p.theme === 'light') {
      state.theme = p.theme;
      CacheStorage.setItem(THEME_KEY, p.theme);
      applyTheme(p.theme);
    } else if (fromServer && pickedTheme()) {
      CacheStorage.removeItem(THEME_KEY);
      state.theme = loadTheme();
      applyTheme(state.theme);
    }
    if (TEXT_SCALES[p.textScale]) {
      state.textScale = applyTextScale(p.textScale);
      CacheStorage.setItem(TEXT_SCALE_KEY, p.textScale);
    } else if (fromServer) {
      state.textScale = applyTextScale('normal');
      CacheStorage.removeItem(TEXT_SCALE_KEY);
    }
    if (typeof p.premium === 'boolean' || fromServer) {
      state.premium = p.premium === true;
      CacheStorage.setItem(PREMIUM_KEY, state.premium ? '1' : '0');
      applyPremium(state.premium);
    }
    // Before this runs, every "Mon-Fri" reminder answers with the default —
    // so it has to happen before the calendar or Home paints their dots.
    setWorkWeek(p.workWeek);
    setRoutine(p.routine);
    setDefaultLead(p.reminderLead);
    // Same reason as the working week: every time on the page is formatted
    // through gb-kit, so the preference has to land before anything paints.
    setTimeFormat(p.timeFormat);
    setLocale(localeFromUser(state.user));
    // The one moment the device gets a vote. Nothing stored yet (a new account,
    // first load) or the old 'auto' — read the phone's own habit and write it
    // to ui_prefs, so from the second load on this is the server's answer and
    // the same on every device the account signs in from.
    if (p.timeFormat !== '12' && p.timeFormat !== '24') {
      saveUiPrefs({ timeFormat: detectTimeFormat() }, { quiet: true });
    }
    // The device copy follows the account: set only, it hid the checklist (and the
    // starter packs on it) from every later account signed in on the same phone.
    if (p.onboardingDone) CacheStorage.setItem('gb.onboardDismissed', '1');
    else CacheStorage.removeItem('gb.onboardDismissed');
    // achSeen is read straight from ui_prefs (checkAchievements): no local mirror.
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

/* The account's today (home-order.js todayKey): the day the server checks a
   check-in or rest day against and stamps on its water/food summaries. */
function todayKey() {
  return sharedTodayKey(state.user && state.user.timezone);
}

/* The clock that goes with todayKey(): HH:MM in the account's zone, the one
   reminders ring in. The device's when the account has none (or an unknown id). */
function accountNowHHMM() {
  const zone = state.user && state.user.timezone;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
  } catch (_) {
    return new Date().toTimeString().slice(0, 5);
  }
}

function yesterdayKey() {
  return shiftDayKey(todayKey(), -1);
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

/* Sync the token balance from the latest habits payload (each habit echoes it).
   After a single-habit write, pass that habit: only it carries the fresh balance.
   Reading the first habit instead kept a sibling's stale count, so freezing a day
   on the second habit still showed "1 freeze left" and the next tap was refused. */
function reconcileStreakFreeze(fresh) {
  const h = fresh || (state.habits || []).find((x) => typeof x.freezeTokens === 'number');
  if (!h || typeof h.freezeTokens !== 'number') return;
  state.freezeTokens = h.freezeTokens;
  state.habits = (state.habits || []).map((x) => ({ ...x, freezeTokens: h.freezeTokens }));
}

function effectiveStreak(habit) {
  return Number(habit.streak) || 0;
}

/* The server's `dueToday` (HabitService.isDue; home-order.js habitDue): paused
   habits and weekly ones whose quota is already met are not owed today. */
function habitDueToday(habit) {
  return habitDue(habit) || !!habit.doneToday;
}

/* "day" for a daily habit, "week" for weekly / N-per-week: their streaks count
   weeks (HabitService.currentWeeklyRun), and "3-day streak" on one was wrong. */
function streakUnit(habit) {
  return (habit.cadence || 'daily') === 'daily' ? 'day' : 'week';
}

/* "Break a habit" (HabitKind.quit): clean by default, the user logs a slip.
   On one, `doneToday` means clean today and `streak` the days since a slip. */
function isQuitHabit(habit) {
  return !!habit && habit.kind === 'quit';
}

/* The row's sub-line for a quit habit: "Breaking · 🛡 5 days clean". */
function quitHabitLabel(habit) {
  if (habit.active === false) return 'Paused · breaking';
  if (!habit.doneToday) return 'Breaking · slipped today';
  const n = Number(habit.streak) || 0;
  return 'Breaking · 🛡 ' + n + ' day' + (n === 1 ? '' : 's') + ' clean';
}

/* What the row says about how often: "daily", "weekly", "3× a week". */
function cadenceLabel(habit) {
  const c = habit.cadence || 'daily';
  if (c === 'custom') return (habit.targetPerWeek || 1) + '× a week';
  return c;
}

/* " · 2/3 this week" for a weekly / N-a-week habit; nothing for a daily one. */
function weekProgressLabel(habit) {
  const c = habit.cadence || 'daily';
  if (c === 'daily') return '';
  const need = c === 'weekly' ? 1 : habit.targetPerWeek || 1;
  return ' · ' + Math.min(habit.doneThisWeek || 0, need) + '/' + need + ' this week';
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
    // Expenses, habit check-ins and finished tasks count as active days too.
    money: state.money,
    history: state.insightHistory,
    // Earned badges stay unlocked even after their days slide out of the 60-day window.
    seen: (state.user && state.user.uiPrefs && state.user.uiPrefs.achSeen) || [],
  };
}

/* Fire a grand celebration the FIRST time each achievement unlocks. We keep a
   per-user list of already-celebrated ids in storage; on the first run after a
   full data load we baseline it silently (so pre-earned badges don't all pop),
   then celebrate anything new that crosses its threshold thereafter. */
function checkAchievements() {
  if (!state.user || !state.achReady) return;
  let all;
  try {
    all = computeAchievements(achievementProps()).flatMap((g) => g.items);
  } catch (err) {
    // A bug in a badge rule, not a missing feature: say so, or badges just stop.
    console.warn('[achievements] compute failed:', err);
    return;
  }
  const unlockedIds = all.filter((i) => i.unlocked).map((i) => i.id);

  // The account's own list, in ui_prefs. It used to be mirrored into a
  // gb.achSeen.<userId> cookie per account ever used on the device, all of them
  // riding on every request. Unioned with this session's ids because any user
  // object the server sent before our achSeen save landed (/api/auth/me, a
  // settings save) replaces uiPrefs with the older list, and the badge would
  // celebrate twice.
  if (achSession.uid !== state.user.id) achSession = { uid: state.user.id, ids: new Set() };
  const stored = state.user.uiPrefs && state.user.uiPrefs.achSeen;
  if (!Array.isArray(stored) && !achSession.ids.size) {
    // First run with real data — baseline, don't celebrate the back-catalogue.
    unlockedIds.forEach((id) => achSession.ids.add(id));
    saveUiPrefs({ achSeen: unlockedIds }, { quiet: true });
    return;
  }
  const seen = new Set([...(Array.isArray(stored) ? stored : []), ...achSession.ids]);
  const fresh = all.filter((i) => i.unlocked && !seen.has(i.id));
  if (!fresh.length) return;
  // Never over a form: not marked seen, so the next render with nothing open
  // celebrates it.
  if (!achQuiet && formInUse()) return;
  // Persist the union BEFORE celebrating so a re-render mid-animation can't
  // double-fire the same badge.
  const union = Array.from(new Set([...seen, ...unlockedIds]));
  union.forEach((id) => achSession.ids.add(id));
  saveUiPrefs({ achSeen: union }, { quiet: true });
  if (achQuiet) return;
  // A badge for setting something up lands as a toast: the full-screen
  // celebration over a goal just made blocked its milestone field.
  fresh.forEach((item) => (SETUP_BADGES.has(item.id) ? toastSuccess('Achievement unlocked: ' + item.title + '.') : celebrate(item)));
}
/* Ids already seen this session, per account. Memory only; ui_prefs is the record. */
let achSession = { uid: null, ids: new Set() };
const SETUP_BADGES = new Set(['goal1']);
/* True while a starter pack is writing: what it unlocks is marked seen, not celebrated. */
let achQuiet = false;
function formInUse() {
  if (document.querySelector('.gb-modal-overlay:not(.is-closing)')) return true;
  const el = document.activeElement;
  return !!el && (el.isContentEditable || el.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button])'));
}

/* Card-facing view of a habit's freeze state, shaped like the old local model. */
function habitFreezeState(habit) {
  return {
    // Not for a 1-day streak: a freeze is a week's earnings, and a banner over
    // one day is noise. The freeze chip still covers any day by hand.
    pendingBreak:
      !!habit.atRisk && (Number(habit.riskStreak) || 0) >= 2 && !dismissedRisk.has(String(habit.id)),
    brokenFrom: Number(habit.riskStreak) || 0,
    frozen: habit.protectedToday ? ['today'] : [],
  };
}

function freezeTokensLeft() {
  return Number(state.freezeTokens) || 0;
}

/* Freeze writes paint first: the habit takes `guess` and the token count moves
   by `tokenDelta` now, the server's habit replaces both when it answers, and a
   failure restores the two exactly. One per habit in flight, or a double tap
   spends two tokens. Returns whether the server took it. */
async function freezeWrite(habitId, path, date, guess, tokenDelta, errorMessage) {
  const key = 'freeze:' + habitId;
  if (togglesInFlight.has(key)) return false;
  const prev = state.habits.find((x) => x.id === habitId);
  if (!prev) return false;
  togglesInFlight.add(key);
  const prevTokens = state.freezeTokens;
  state.freezeTokens = Math.max(0, freezeTokensLeft() + tokenDelta);
  state.habits = state.habits.map((x) =>
    x.id === habitId ? { ...x, ...guess, freezeTokens: state.freezeTokens } : x
  );
  render();
  try {
    const updated = await api('/api/habits/' + encodeURIComponent(habitId) + path, {
      method: 'POST',
      body: JSON.stringify({ date }),
    });
    state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
    reconcileStreakFreeze(updated);
    render();
    return true;
  } catch (err) {
    state.habits = state.habits.map((x) => (x.id === habitId ? prev : x));
    state.freezeTokens = prevTokens;
    reconcileStreakFreeze(prev);
    render();
    toastError(err, errorMessage);
    return false;
  } finally {
    togglesInFlight.delete(key);
  }
}

/* Spend a freeze to rescue yesterday's missed day and keep the streak alive. */
async function protectStreak(habitId) {
  const ok = await freezeWrite(
    habitId,
    '/protect',
    yesterdayKey(),
    { atRisk: false },
    -1,
    'Could not protect your streak.'
  );
  if (ok) toastSuccess('Streak protected with a freeze.');
}

/* ---- Take a break (I-08) ----
   ui_prefs.breakFrom..breakUntil (break.js). The server holds every streak over
   it without a token, owes nothing those days (the score), and keeps habit
   reminders, the evening reflection and the digest quiet; this device's habit
   alarms follow (reSyncDeviceAlarms). Timed reminders still ring. Started from
   Settings > Alerts or Home's at-risk entry; ended early with one tap. */
function breakPrefs() {
  return (state.user && state.user.uiPrefs) || {};
}

function breakUntilLabel(until) {
  return fmtDate(until, 'weekdayDate');
}

async function setBreak(patch, message) {
  const saved = saveUiPrefs(patch);
  render();
  reSyncDeviceAlarms();
  await saved;
  // Streaks, "owed today" and the score are the server's; read them back.
  try {
    state.habits = await api('/api/habits');
    reconcileStreakFreeze();
  } catch (_) {
    /* the next load brings them */
  }
  await refreshScore();
  render();
  if (message) toastSuccess(message);
}

function takeBreak(days, rescue) {
  const patch = startBreak(days, todayKey(), rescue);
  return setBreak(patch, 'On a break until ' + breakUntilLabel(patch.breakUntil) + '. Your streaks are held.');
}

function endBreakNow() {
  return setBreak(endBreak(todayKey()), 'Break ended.');
}

/* Home's one line about a break: on one, back from one, or offered when a
   streak is at risk (a rescue, so it covers the missed yesterday too). */
function homeBreakEntry() {
  if (!featureOn('habits') || !(state.habits || []).length) return null;
  const st = breakState(breakPrefs(), todayKey());
  const btn = (label, onclick, primary) =>
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--compact ' + (primary ? 'gb-btn--primary' : 'gb-btn--soft'), onclick },
      label
    );
  const card = (kicker, title, why, buttons) =>
    Card({
      className: 'gb-coach-card gb-break-card',
      children: [
        h(
          'div',
          null,
          h('div', { class: 'gb-coach-kicker' }, kicker),
          h('div', { class: 'gb-coach-title' }, title),
          h('div', { class: 'gb-coach-why' }, why)
        ),
        buttons.length ? h('div', { class: 'gb-coach-chiprow' }, ...buttons) : null,
      ],
    });
  if (st && st.on) {
    return card(
      'On a break',
      'Until ' + breakUntilLabel(st.until),
      'Your streaks are held and habit reminders are off. Reminders you set a time for still ring.',
      [btn('End now', endBreakNow, false)]
    );
  }
  if (st && st.back) {
    const build = (state.habits || []).filter((x) => x.active !== false && !isQuitHabit(x));
    const next = sortHabitsForHome(build).find((x) => !x.doneToday && habitDue(x));
    return card(
      'Back on it',
      'Your streaks are intact.',
      next ? 'One to start with: ' + next.name + '.' : 'Pick up wherever suits you today.',
      next ? [btn('Mark ' + next.name + ' done', () => toggleHabit(next.id), true)] : []
    );
  }
  if (!(state.habits || []).some((x) => habitFreezeState(x).pendingBreak)) return null;
  return card(
    'Rough week?',
    'Take a break',
    'Your streaks hold and habit reminders go quiet. Reminders you set a time for still ring.',
    BREAK_LENGTHS.map((n) => btn(n + ' days', () => takeBreak(n, true), n === BREAK_LENGTHS[0]))
  );
}

/* Dismiss the at-risk prompt and let the streak reset (no token spent). */
function declineStreakBreak(habitId) {
  dismissedRisk.add(String(habitId));
  render();
}

/* Proactively mark today as a rest day (spends a token), or undo it (refunds). */
async function toggleRestDay(habitId, makeRest) {
  const ok = await freezeWrite(
    habitId,
    makeRest ? '/protect' : '/unprotect',
    // No date: the server's "today", in the account's zone. The device's date
    // was a day ahead whenever the two zones disagreed (travel, an API signup on
    // UTC), and the server refused it as a day that hadn't started.
    null,
    { protectedToday: makeRest },
    makeRest ? -1 : 1,
    makeRest ? 'Could not set a rest day.' : 'Could not remove the rest day.'
  );
  if (!ok) return;
  if (!makeRest) return toastSuccess('Rest day removed — the freeze is back.');
  // One tap spends a freeze, so the receipt says so and can take it back.
  const left = freezeTokensLeft();
  pushToast('1 freeze used, ' + left + ' left.', 'success', 6000, {
    label: 'Undo',
    run: () => toggleRestDay(habitId, false),
  });
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
    console.error('CRITICAL: recordTrendsToday snapshot failed to reach database:', err);
  });
}

/* Sign-out leaves nothing of this account on the device: money, wellness, goal
   progress, trends, the app's boot snapshot — every key built as
   gb.<thing>.<userId>[.<more>] (session.js isUserKey). Every way out runs it, a
   401 included: whoever signs in next on this device is not necessarily the
   same person. Except writes the server never got, the only copy there is:
   a money pending queue that still holds some is kept (it replays when this
   account signs back in), and so are the offline outbox and the water queue
   when the session expired rather than being ended on purpose. */
function purgeUserCache(reason) {
  const id = state.user && state.user.id;
  if (!id) return;
  const p = loadPendingLedger();
  const keepMoney = reason !== 'deleted' && (Object.keys(p.upserts).length || p.deletes.length);
  const keepOutbox = reason === 'expired' && outbox.size() ? outboxKey() : null;
  // Glasses logged offline, likewise: the only copy, and they replay on sign-in.
  const keepWater = reason === 'expired' && loadWaterQueue().length ? waterQueueKey() : null;
  const keep = keepMoney ? pendingKey() : null;
  // Unsent Money document edits stay too (stored only while non-empty), like the ledger queue.
  const keepDoc = reason !== 'deleted' ? docPendingKey() : null;
  const gone = CacheStorage.removeWhere(
    (k) => k !== keepOutbox && k !== keepWater && k !== keepDoc && isUserKey(k, id, keep)
  );
  if (!keepOutbox) outbox.clear();
  outboxIds.clear();
  return gone;
}

function clearSession() {
  CacheStorage.removeItem(SESSION_KEY);
  CacheStorage.removeItem(TOKEN_KEY);
  clearNativeAuth();
  // The sound goes too, and whoever signs in next gets their own looked up
  // rather than inheriting the previous account's. It was keyed per device and
  // never per user, so on a shared device the next person heard the last
  // person's file. Safe to drop now that the account keeps a copy: signing back
  // in pulls it straight down again.
  storeCustomChimes([]);
  customChimePulled = false;
  // The notes composer keeps an unsaved draft in module memory; it is not the next account's.
  import('./notes.js').then((m) => m.clearNoteDraft()).catch(() => {});
  // The Notes list's offline copy (notes-core.js offlineKey) is that account's
  // notes in plain text on this device: it leaves with the session.
  CacheStorage.removeWhere((k) => k.startsWith('gb.notesOffline.')).catch(() => {});
}

/* The ONLY way a signed-in user reaches `state` — sign-in, OTP verify, password
   reset and every profile save all come through here, because this is where
   hydrateUiPrefs() runs. Set `state.user` directly and the account's theme, text
   size and premium skin stay at this device's defaults until something else
   happens to call /api/auth/me.

   A token on the payload wins over the stored one: at sign-in nothing is stored
   yet, and after a password change the stored one has just been revoked. */
function syncUserSession(userPatch) {
  if (userPatch && userPatch.uiPrefs && uiPrefsInFlight.size)
    userPatch = Object.assign({}, userPatch, {
      uiPrefs: Object.assign({}, userPatch.uiPrefs, ...uiPrefsInFlight.values()),
    });
  const token = (userPatch && userPatch.token) || loadToken();
  state.user = Object.assign({}, state.user || {}, userPatch || {});
  if (token) {
    state.user.token = token;
  }
  saveSession(state.user, token);
  hydrateUiPrefs(!!userPatch && userPatch.uiPrefs !== undefined);
  // The bytes are too big for ui_prefs, so they come down on their own. Not
  // awaited: nothing on screen waits for a notification sound, and a failure
  // here must never be the thing that stops a sign-in.
  pullCustomChime();
  syncDeviceTimezone();
}

/* "Today" on the server is the stored timezone's today (UserClock), and
   reminders fire on it too. It was set at signup and only ever changed by hand,
   so after a flight, or on an account made on UTC, the phone was a day ahead
   and a rest day was refused as a day that hadn't started. Offered, not forced:
   someone abroad for a weekend may want home time. Asked once per phone zone
   (`ui_prefs.tzAsked`), so "Keep" sticks until the phone moves again. Waits a
   beat so it never lands on top of the first paint. */
let tzOfferTimer = 0;
function syncDeviceTimezone() {
  clearTimeout(tzOfferTimer);
  tzOfferTimer = setTimeout(offerDeviceTimezone, 1500);
}
function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (_) {
    return ''; // no Intl zone: nothing to compare
  }
}
/* The one timezone write, shared by the offer below and first-run setup. */
async function saveDeviceTimezone(tz) {
  const me = await api('/api/auth/timezone', {
    method: 'PUT',
    body: JSON.stringify({ timezone: tz }),
  });
  syncUserSession(me || {});
  toastSuccess('Timezone set to ' + tz + '.');
  loadData();
}
function offerDeviceTimezone() {
  const tz = deviceZone();
  const u = state.user;
  if (!tz || !u || !u.id || !u.timezone || sameZone(u.timezone, tz)) return;
  // Not decided yet whether this account gets first-run setup, which asks the
  // same question itself. maybeStartFirstRun() re-arms this when it says no.
  if (!(u.uiPrefs && u.uiPrefs.setupDone)) return;
  if ((u.uiPrefs && u.uiPrefs.tzAsked) === tz) return;
  // Never on top of a sheet the user opened: wait until it is closed, and only
  // then count the question as asked.
  if (document.querySelector('.gb-modal-overlay.is-open')) {
    tzOfferTimer = setTimeout(offerDeviceTimezone, 3000);
    return;
  }
  saveUiPrefs({ tzAsked: tz }, { quiet: true });
  openModal({
    title: 'Switch to ' + tz + '?',
    sub:
      'Your phone is on ' +
      tz +
      ', your account on ' +
      u.timezone +
      '. Days, streaks and reminder times follow the account.',
    body: h('div', { class: 'gb-note-hint' }, 'You can change it later in Settings, Profile.'),
    primary: 'Switch',
    dismiss: 'Keep ' + u.timezone,
    onPrimary: () => saveDeviceTimezone(tz),
  });
}

/* Ask for notification permission and say how it went. Settings › Alerts and
   the first timed save (askPushOnce) share it. Resolves true only when push is on. */
async function enablePushFlow(okMessage) {
  const native = localNotificationsAvailable();
  const r = await enablePush(api);
  if (r === 'ok') {
    // Nothing was queued while permission was refused; arm it all now.
    reSyncDeviceAlarms();
    toastSuccess(okMessage || 'Notifications on.');
    return true;
  }
  if (r === 'unconfigured') {
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
  return false;
}

/* The notification ask, at the moment it makes sense: the first time a timed
   reminder or a habit with a reminder time is saved (and once at the end of
   first-run when the goal step made timed ones). Once per account
   (`ui_prefs.pushAsked`, recorded before asking, so a refusal is never
   re-asked), only when this device can notify and push is off. In the app the
   permission is the native one (localNotificationPermission), never the
   WebView's Notification. The rules are pushAskDue in app-logic.js. */
async function askPushOnce(needs) {
  if (!needs || !state.user || firstRunOpen || !pushSupported()) return;
  const native = localNotificationsAvailable();
  const [subscribed, permission] = await Promise.all([
    pushSubscribed(),
    native ? localNotificationPermission() : typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  ]);
  // Re-read after the awaits: two quick saves must not both ask.
  const due = pushAskDue({
    needs,
    setupOpen: firstRunOpen,
    asked: !!(state.user && (state.user.uiPrefs || {}).pushAsked),
    supported: true,
    subscribed,
    permission,
  });
  if (!due || !state.user) return;
  saveUiPrefs({ pushAsked: true });
  enablePushFlow('Notifications on. Your reminders will ring here.');
}

/* ---- First-run setup ----
   Once per account, after a NEW account's first data load: a goal (the
   starter-pack picker, starterPicker), then the timezone only when the device
   and the account disagree (firstRunSteps, app-logic.js). Notifications are
   asked at the first timed save (askPushOnce); features stay in Settings ›
   Layout, all on. Decided in
   loadData() once wave 1 lands, because "new" is read from real data: an
   account that already has tasks, habits or reminders, or dismissed the Home
   checklist, is marked `ui_prefs.setupDone` silently and never sees it. Any
   way out (Done, Skip on the last step, Escape, the backdrop) sets setupDone,
   so it can't come back on another device either. While it is undecided,
   offerDeviceTimezone() stands down — the timezone step asks the same thing. */
let firstRunOpen = false;
function maybeStartFirstRun() {
  const u = state.user;
  if (!u || !u.id || firstRunOpen) return;
  const p = u.uiPrefs || {};
  if (p.setupDone) return maybeAskPermissions();
  // Begun but never finished (the app was closed mid-way): its own goal step
  // made the habits, so the data check below would end it unseen. Resume.
  if (p.setupStep) {
    setTimeout(() => openFirstRunSetup(p.setupStep), 600);
    return;
  }
  const hasData =
    (state.tasks || []).length > 0 ||
    (state.habits || []).length > 0 ||
    (state.reminders || []).length > 0 ||
    !!p.onboardingDone;
  if (hasData) {
    saveUiPrefs({ setupDone: true });
    syncDeviceTimezone(); // the offer stood down while this was undecided
    maybeAskPermissions();
    return;
  }
  // A beat after first paint, like the timezone offer, so it lands on Home
  // rather than on the loading card.
  setTimeout(openFirstRunSetup, 600);
}

/* Accounts set up before health data existed: ask once, on the phone, for
   notifications (if this phone hasn't answered yet) and health access. New
   accounts get the same two as first-run steps. Marked asked the moment it
   shows, so a dismissed sheet never comes back; Settings and the Health
   screen can still connect. */
async function maybeAskPermissions() {
  const p = (state.user && state.user.uiPrefs) || {};
  if (!isNative() || p.healthAsked || firstRunOpen) return;
  if (!(await healthAvailable())) return;
  // Android 13+ can answer 'prompt-with-rationale' after one refusal.
  const askNotify = String(await localNotificationPermission()).startsWith('prompt');
  saveUiPrefs({ healthAsked: true });
  setTimeout(
    () =>
      openModal({
        title: askNotify ? 'Two quick permissions' : 'Connect your health data',
        sub: 'Your phone asks next. You can change either later in its settings.',
        body: h(
          'div',
          { class: 'gb-form' },
          askNotify ? h('p', { class: 'gb-setup-text' }, 'Notifications: reminders and habit nudges, even with the app closed.') : null,
          h('p', { class: 'gb-setup-text' }, HEALTH_PITCH)
        ),
        primary: 'Allow',
        onPrimary: async () => {
          if (askNotify) await enablePushFlow('Notifications on.');
          await connectHealth();
        },
      }),
    600
  );
}

const HEALTH_PITCH =
  'Health data: steps, sleep, heart rate and workouts, so habits tick themselves and last night’s sleep logs itself. Read only; Growth Buddy never writes to it.';

// `resumeAt`: the step key ui_prefs.setupStep saved, when an earlier run of
// this sheet was left without finishing.
const SETUP_ORDER = ['goal', 'timezone', 'notify', 'health', 'features'];
async function openFirstRunSetup(resumeAt) {
  if (firstRunOpen || !state.user || (state.user.uiPrefs || {}).setupDone) return;
  firstRunOpen = true;
  // The goal step needs starter-packs.js; offline or a failed chunk just drops it.
  const mod = await import('./starter-packs.js').catch(() => null);
  // Signed out (or set up elsewhere) while the chunk loaded: no sheet, and no
  // firstRunOpen stuck true, which would skip the next account's setup in this tab.
  if (!state.user || (state.user.uiPrefs || {}).setupDone) {
    firstRunOpen = false;
    return;
  }
  const tz = deviceZone();
  // ov-onboard's short list (goal, then the zone only when it differs) plus
  // main's health step on the phone. Notifications wait for the first timed
  // save (askPushOnce); features stay in Settings > Layout.
  const STEP_FNS = { goal: goalStep, timezone: timezoneStep, health: healthStep };
  const keys = firstRunSteps({
    hasGoal: !!mod,
    accountZone: state.user.timezone,
    deviceZone: tz,
  });
  if (isNative()) keys.push('health');
  const steps = keys.map((k) => STEP_FNS[k]);
  if (!steps.length) {
    // No goal chunk (offline) and nothing to ask about the zone: setup is done.
    firstRunOpen = false;
    saveUiPrefs(tz ? { setupDone: true, tzAsked: tz } : { setupDone: true });
    syncDeviceTimezone();
    return;
  }
  const { sheet, close } = openOverlay({
    label: 'Set up Growth Buddy',
    className: 'gb-setup-modal',
    onClose: () => {
      firstRunOpen = false;
      // Whatever step it was left on, it has been seen: never again.
      const done = isNative()
        ? { setupDone: true, setupStep: null, healthAsked: true }
        : { setupDone: true, setupStep: null };
      saveUiPrefs(tz ? { ...done, tzAsked: tz } : done);
      // Home drew an empty shell while setup was pending (setupPending in
      // dashboard.js); nothing else re-renders on Skip, Escape or the backdrop,
      // so Home stayed blank until a reload.
      if (state.user) render();
      syncDeviceTimezone();
      // The goal step may have made timed habits and reminders: they are the
      // first thing worth a notification, and the sheet is gone now.
      askPushOnce(
        (state.reminders || []).some((r) => r.time) || (state.habits || []).some((x) => x.reminderTime)
      );
    },
  });

  const stepKey = (i) => keys[i];
  // Resume on the saved step, or the first one after it that is still offered
  // (a run saved on the old notify / features steps lands on what follows them).
  const from = SETUP_ORDER.indexOf(resumeAt);
  let at = Math.max(0, from < 0 ? 0 : keys.findIndex((k) => SETUP_ORDER.indexOf(k) >= from));
  // Progress lives in ui_prefs, so a closed app comes back here, not to a
  // silent "done" (the goal step's habits read as data that predates setup).
  const saveStep = () => saveUiPrefs({ setupStep: stepKey(at) });
  saveStep();
  let saidDone = false; // the goal step's apply() already toasts "You're set up"
  const dots = h(
    'div',
    { class: 'gb-setup-dots', 'aria-hidden': 'true' },
    ...steps.map(() => h('span', { class: 'gb-setup-dot' }))
  );
  const stepLabel = h('div', { class: 'gb-setup-count' });
  const titleEl = h('div', { class: 'gb-modal-title' });
  const subEl = h('div', { class: 'gb-modal-sub' });
  const bodyEl = h('div', { class: 'gb-modal-body' });
  const primaryBtn = h('button', {
    type: 'button',
    class: 'gb-btn gb-btn--primary',
    style: { width: '100%', marginTop: '14px' },
  });
  const skipBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel' });

  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      // One step needs no "Step 1 of 1".
      steps.length > 1 ? h('div', { class: 'gb-setup-top' }, stepLabel, dots) : null,
      titleEl,
      subEl
    ),
    bodyEl,
    primaryBtn,
    skipBtn
  );

  function next() {
    if (at >= steps.length - 1) {
      if (!saidDone) toastSuccess('You’re all set.');
      close();
      return;
    }
    at += 1;
    saveStep();
    show();
  }

  function show() {
    const s = steps[at]();
    stepLabel.textContent = 'Step ' + (at + 1) + ' of ' + steps.length;
    [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i <= at));
    titleEl.textContent = s.title;
    subEl.textContent = s.sub;
    bodyEl.replaceChildren(s.body);
    primaryBtn.textContent = s.primary;
    primaryBtn.disabled = false;
    primaryBtn.onclick = async () => {
      primaryBtn.disabled = true;
      try {
        if (s.onPrimary) await s.onPrimary();
        next();
      } catch (err) {
        primaryBtn.disabled = false;
        shakeRefusal(sheet);
        toastError(err, 'Something went wrong.');
      }
    };
    skipBtn.textContent = s.skip;
    skipBtn.onclick = next;
    refreshIcons();
    titleEl.setAttribute('tabindex', '-1');
    titleEl.focus({ preventScroll: true });
  }

  function badge(icon) {
    return h('div', { class: 'gb-setup-badge' }, Icon(icon, { size: 22, sw: 2.2 }));
  }

  // First, so the one question that matters gets the fresh attention. Habit and
  // reminder times are local and follow the user, so the timezone step after
  // it changes nothing they hold. The loadData() inside apply() is a refresh:
  // it never re-enters maybeStartFirstRun, and firstRunOpen is already true.
  // ponytail: a new account has no spending, so planStarter offers no budget
  // (budgetsFrom); offer one once Money has 30 days of spending.
  function goalStep() {
    const p = starterPicker(mod);
    // The button says what it will do: "Next" (or "Done" when nothing follows) until a chip is on.
    const idle = steps.length > 1 ? 'Next' : 'Done';
    p.body.addEventListener('click', () => {
      if (steps[at] === goalStep) primaryBtn.textContent = p.picked() ? 'Set it up' : idle;
    });
    return {
      title: 'What do you want to change?',
      sub: 'Pick one or more. We set up habits, reminders and a 30-day goal.',
      body: p.body,
      primary: idle,
      onPrimary: () => (p.picked() ? p.apply().then(() => (saidDone = true)) : null),
      skip: 'Skip',
    };
  }

  // Only in the list when the device and the account disagree (firstRunSteps).
  function timezoneStep() {
    const saved = (state.user && state.user.timezone) || '';
    const zoneRow = (label, value) =>
      h(
        'div',
        { class: 'gb-setup-zone' },
        h('span', { class: 'gb-setup-zone-lbl' }, label),
        h('span', { class: 'gb-setup-zone-val' }, value || 'Not set')
      );
    return {
      title: 'Your timezone',
      sub: 'Days, streaks and reminder times follow it.',
      body: h(
        'div',
        {},
        badge('clock'),
        zoneRow('This device', tz),
        zoneRow('Your account', saved),
        h('div', { class: 'gb-field-hint' }, 'They differ. Use this device’s zone unless you want to keep home time.')
      ),
      primary: 'Use ' + tz,
      onPrimary: () => saveDeviceTimezone(tz),
      skip: 'Keep ' + saved,
    };
  }

  function healthStep() {
    return {
      title: 'Connect your health data',
      sub: /android/i.test(navigator.userAgent) ? 'Through Health Connect.' : 'Through Apple Health.',
      body: h('div', {}, badge('activity'), h('p', { class: 'gb-setup-text' }, HEALTH_PITCH)),
      primary: 'Connect',
      onPrimary: connectHealth,
      skip: 'Not now',
    };
  }

  show();
}

// In-flight dedup for idempotent GETs: if the same GET is already running,
// hand back the same promise instead of opening a second connection. Cleared
// the moment it settles, so this collapses concurrent duplicates without ever
// serving stale data (it is not a cache). Mutations always bypass it.
const _inflightGets = new Map();

const SESSION_EXPIRED = 'Your session expired. Please sign in again.';

async function api(path, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  // Only a plain GET is shared. One with onResponse (the money ETag), raw or its
  // own headers needs its own response: handed the first caller's promise, its
  // onResponse never ran and the next PUT sent a stale If-Match.
  if (method === 'GET' && !opts.body && !opts.onResponse && !opts.raw && !opts.headers) {
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

/* A fetch that never got a response at all. In production the server is not
   the user's to start, so "make sure Growth Buddy is running" read as nonsense
   on a phone — at that end the cause is almost always the connection. */
// No gesture in it: this shows on desktop too, and pull to refresh is a swipe DOWN.
const NO_CONNECTION = 'No connection. Check your internet and try again.';

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

/* The session generation (session.js) is noted before the request goes out:
   an answer that lands after a sign-out rejects with sessionEndedError() and
   writes nothing, and its 401 doesn't end the NEXT session. */
async function apiFetch(path, options) {
  const gen = sessionGen();
  try {
    const out = await apiFetchNow(path, options, gen);
    if (isStaleSession(gen)) throw sessionEndedError();
    return out;
  } catch (err) {
    throw isStaleSession(gen) ? sessionEndedError() : err;
  }
}

async function apiFetchNow(path, options, gen) {
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
    // No answer at all, even while navigator.onLine says yes (server unreachable): say so.
    handleOffline();
    throw new Error(NO_CONNECTION);
  }
  // Any answer, even an error, means the server is reachable again. Only the
  // browser's 'online' event used to clear the banner, and after a server that
  // didn't answer (Render waking, a dropped request) that event never comes.
  if (!state.online) handleOnline();
  if (isStaleSession(gen)) throw sessionEndedError();
  if (res.status === 401) {
    // Token went stale (revoked, expired, server restarted with empty DB,
    // etc.) — wipe local state and bounce to the sign-in screen.
    handleAuthExpired();
    throw new Error(SESSION_EXPIRED);
  }
  if (!res.ok) {
    let msg = statusMessage(res.status);
    let code;
    let body;
    try {
      body = await res.json();
      msg = body.message || msg;
      code = body.code;
    } catch (_) {
      // ignored
    }
    const err = new Error(msg);
    err.status = res.status;
    // The answer itself: a goal progress 409 carries the current copy (goal-merge.js merges onto it).
    err.body = body;
    // ApiError.code, e.g. 'idempotency_in_progress' (a replay racing its first try).
    if (code) err.code = code;
    throw err;
  }
  if (typeof opts.onResponse === 'function') {
    const read = opts.onResponse(res);
    // raw: the caller reads the body itself (a file, not JSON), so wait for it.
    if (opts.raw) await read;
  }
  if (opts.raw || res.status === 204) {
    return null;
  }
  return res.json();
}

/* POST that answers text/event-stream (Buddy's streamed reply). Resolves to the
   open Response for the caller to read; EventSource can't POST or carry the
   bearer header, hence fetch. Throws an Error with `fallback: true` when the
   plain endpoint should be used instead — no response at all, an older server
   (404/405), or a body that isn't an event stream (a proxy's page) — and a
   normal error, with the server's message, for anything else: a 429 sent again
   as a plain POST would only be refused twice. */
async function apiStream(path, body, signal) {
  const headers = {
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json',
  };
  const token = loadToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const device = deviceLabelHeader();
  if (device) headers['X-GB-Device'] = device;
  const fallback = (msg) => Object.assign(new Error(msg), { fallback: true });
  const gen = sessionGen();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw fallback(NO_CONNECTION);
  }
  if (isStaleSession(gen)) throw sessionEndedError();
  if (res.status === 401) {
    handleAuthExpired();
    throw new Error(SESSION_EXPIRED);
  }
  if (res.status === 404 || res.status === 405) throw fallback('Streaming not supported');
  if (!res.ok) {
    let msg = statusMessage(res.status);
    try {
      msg = (await res.json()).message || msg;
    } catch (_) {
      // ignored
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (!/text\/event-stream/i.test(res.headers.get('Content-Type') || '') || !res.body) {
    throw fallback('Not an event stream');
  }
  return res;
}

/* A 401 from api() or the stream: the token was revoked, expired, or signed
   out everywhere. Same teardown as Sign out, minus the server calls the dead
   token can't make. */
function handleAuthExpired() {
  endSession('expired');
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
        formatTime(dt);
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
    // The stored priority, never a display override: showing an overdue task
    // as High fed the edit dialog, and Save wrote High back to the server.
    // Overdue is its own flag; the row paints it.
    priority: task.priority || 'Medium',
    overdue:
      !task.done && !task.paused && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now(),
    done: !!task.done,
    paused: !!task.paused,
    dueAt: task.dueAt || null,
    doneAt: task.doneAt || null,
    completionCount: task.completionCount || 0,
    pushCount: task.pushCount || 0,
    goalId: task.goalId || null,
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
    // Only the day on screen needs its answer painted; tapping through days
    // used to repaint the panel once more for every day already left behind.
    if (dayKey === state.selectedDate) {
      rerenderCalendarSideIfActive();
      rerenderHomeMiniCalendarIfActive();
    }
  }
}

/**
 * Replace only the right-hand calendar side panel in place. The form
 * DOM is module-cached inside calendar.js, so the user's in-progress
 * reminder text / tag / repeat survives. Falls back to a full render
 * if we can't find the panel in the DOM (different screen, first paint).
 */
/* Coalesced: one tap on a day used to repaint the panel two or three times in
   the same tick (the selection, then the food fetch flagging "loading"). Every
   caller in a tick now shares one repaint, run before the frame is drawn. */
let sideRepaintQueued = false;
// Read when the repaint was asked for: addReminder's finally has cleared
// addingReminder by the time the microtask runs.
let sideRepaintForAdd = false;
function rerenderCalendarSideIfActive() {
  if (state.screen !== 'calendar') return;
  if (addingReminder) sideRepaintForAdd = true;
  if (sideRepaintQueued) return;
  sideRepaintQueued = true;
  queueMicrotask(() => {
    sideRepaintQueued = false;
    const forAdd = sideRepaintForAdd;
    sideRepaintForAdd = false;
    repaintCalendarSideNow(forAdd);
  });
}

/* The panel a repaint is waiting on while someone types in it. */
let sideDeferredFor = null;

function repaintCalendarSideNow(forAdd) {
  if (state.screen !== 'calendar') return;
  const oldSide = document.querySelector('.gb-cal-side');
  if (!oldSide || !RenderCalendarSide) {
    render();
    return;
  }
  // The reminder form is one cached node that moves into the new panel, and
  // moving a focused input out of the page blurs it: the keyboard dropped
  // mid-word whenever a day's food answered. While a field in the panel has
  // focus, a repaint waits until focus leaves the panel. Adding a reminder is
  // the exception, since its list has to show the new row; it gets its focus
  // back below.
  const active = document.activeElement;
  const hadFocus = oldSide.contains(active);
  if (hadFocus && !forAdd && active.matches('input, textarea, select')) {
    if (sideDeferredFor !== oldSide) {
      sideDeferredFor = oldSide;
      const onOut = (e) => {
        if (e.relatedTarget && oldSide.contains(e.relatedTarget)) return;
        oldSide.removeEventListener('focusout', onOut);
        sideDeferredFor = null;
        rerenderCalendarSideIfActive();
      };
      oldSide.addEventListener('focusout', onOut);
    }
    return;
  }
  const focusKey = hadFocus ? focusLocator(active, oldSide) : null;
  const newSide = RenderCalendarSide({
    selectedDate: state.selectedDate,
    reminders: state.reminders,
    tasks: state.tasks,
    habits: state.habits,
    habitHistory: state.insightHistory && state.insightHistory.habits,
    goals: state.goals,
    wellness: state.wellness,
    foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
    dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
    dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
    onRetryFood: retryCalendarFoodDate,
    onAddReminder: addReminder,
    onDeleteReminder: deleteReminder,
    onEditReminder: editReminder,
    onCancelSnooze: cancelReminderSnooze,
    onToggleDone: toggleReminderDone,
    onSelectDate: selectDate,
    onSaveRoutine: saveRoutine,
    whatsappEnabled: !!(state.user && state.user.whatsappEnabled),
  });
  // While the day's food is loading, the panel keeps the height it had: the
  // one-line "Loading" stand-in collapsed it and the answer grew it back.
  // On the day log, not the panel: .gb-cal-side is display: contents, no box.
  const oldLog = oldSide.querySelector('.gb-cal-daylog');
  const newLog = newSide.querySelector('.gb-cal-daylog');
  if (state.calendarFoodLoadingFor === state.selectedDate && oldLog && newLog) {
    newLog.style.minHeight = oldLog.offsetHeight + 'px';
  }
  oldSide.replaceWith(newSide);
  refreshIcons();
  if (forAdd && (hadFocus || active === document.body)) {
    // After an add the caret goes back to the reminder text, cleared and ready
    // for the next one. It used to land nowhere: the Add button disables itself
    // while saving, which drops focus, and the panel swap blurred the input.
    newSide.querySelector('input[aria-label="Reminder text"]')?.focus({ preventScroll: true });
  } else if (hadFocus) {
    // The cached form is the same node, now in the new panel: focus it again.
    // Anything else, by locator.
    if (newSide.contains(active)) active.focus({ preventScroll: true });
    else refocus(focusKey, newSide);
  }
}

/* Coalesced like the calendar side panel above: a tap on a day asked for the
   selection, then for the food fetch's "loading", in the same tick, and the
   card was rebuilt each time. Callers in a tick share one rebuild; the answer
   to true/false ("is there a card to repaint?") is still given synchronously. */
let homeMiniRepaintQueued = false;
function rerenderHomeMiniCalendarIfActive() {
  if (state.screen !== 'home') return false;
  if (!document.querySelector('.gb-mini-cal-card') || !RenderMiniCalendarCard) {
    return false;
  }
  if (!homeMiniRepaintQueued) {
    homeMiniRepaintQueued = true;
    queueMicrotask(() => {
      homeMiniRepaintQueued = false;
      repaintHomeMiniCalendarNow();
    });
  }
  return true;
}

function repaintHomeMiniCalendarNow() {
  if (state.screen !== 'home') return;
  const oldCard = document.querySelector('.gb-mini-cal-card');
  if (!oldCard) return;
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
  // A refresh (back online, pull to refresh, Quick add) keeps the screen up and
  // repaints it in place; only the first load for this account shows the
  // loading card, and only that one can end on the crash card. Coming back
  // online used to swap the whole screen for the quote, then for the crash card
  // if any one of the five calls failed.
  const userKey = state.user.id || state.user.email;
  const refresh = loadedFor === userKey && !state.error;
  const gen = sessionGen();
  if (!refresh) {
    // Refreshing on /family used to run quote card -> family skeleton -> family:
    // the boot screen was waiting on five calls that screen never reads. Screens
    // that fetch their own data paint immediately instead, and wave 1 lands
    // behind them.
    state.loading = !SELF_LOADING_SCREENS.has(state.screen);
    state.error = '';
    render();
  }
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
      // Home's Outlook card code (lazy for the boot chunk's sake); a failed load
      // only leaves that card out.
      loadOutlook().catch(() => null),
    ]);
    state.tasks = tasksRaw.map(mapTask);
    state.habits = habits;
    reconcileStreakFreeze();
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : 0;
    // The water queue is Cache-API-only: read before hydration it is [], and the
    // next store would overwrite last session's unsent glasses.
    await CacheStorage.ready();
    restoreWaterQueue();
    state.water = withPendingWater(water);
    flushWaterQueue();
    state.reminders = reminders;
    alarmInputsLoaded = true;
    // Offline writes the server hasn't seen yet, then send them. Not awaited:
    // first paint doesn't wait on a replay; the flush refetches what it touched.
    // The queue itself is read only once CacheStorage has hydrated it.
    await CacheStorage.ready();
    if (isStaleSession(gen)) return; // signed out while the queue hydrated
    if (revivedFor !== userKey) {
      // Writes whose page unloaded mid-request (sendAhead) are ordinary queued ones now.
      revivedFor = userKey;
      outbox.reviveLive();
      const wq = loadWaterQueue();
      if (wq.some((x) => x.live)) storeWaterQueue(wq.map(({ live, ...x }) => x)); // eslint-disable-line no-unused-vars
    }
    saveBootSnapshot();
    overlayOutbox();
    flushOutbox();
    reSyncDeviceAlarms();
    waterHoursLoad = loadWaterUsualHours();
    // Linked habits count today's readings; without them a typed-in walk is missed.
    if ((state.habits || []).some((hb) => hb.healthLink && hb.healthLink !== 'sleep')) loadHealthReadings();
    syncHealthFromPhone(); // ends with autoTickHealthHabits
    autoTickHealthHabits();
    loadPhoneNight();
  } catch (err) {
    if (err && err.sessionEnded) return; // that session is gone; this answer is nobody's
    if (refresh) {
      toastError(err, 'Could not refresh. Showing your last data.');
      return;
    }
    if (bootFromSnapshot(err, isNative()) && (await paintBootSnapshot(userKey))) return;
    state.error = err.message || 'Failed to load data from backend.';
    state.loading = false;
    render();
    return;
  }
  state.loading = false;
  loadedFor = userKey;
  // Wave 2's requests go out BEFORE the render below, not after it: on a slow
  // phone the first Home render is a 120 ms task, and nothing was in flight
  // during it. Only its sends happen now; every handler lands after the render.
  loadSecondaryData();
  // <- first paint happens here, on five calls instead of twelve. Unless we're
  // still on a self-loading screen, which painted at the top of this function:
  // re-rendering would rebuild its subtree and restart its own fetch.
  if (!SELF_LOADING_SCREENS.has(state.screen)) render();
  // The 'home painted' RUM mark (scripts/vitals.js): the first Home with data.
  if (!refresh && state.screen === 'home') markHomePainted();
  // Needs wave 1: "is this a new account?" is read from tasks/habits/reminders.
  if (!refresh) maybeStartFirstRun();
  // A manifest shortcut or a share: needs wave 1 (water, tasks) on screen.
  if (!refresh) runLaunchIntent();
  // After wave 1, so a button press that cold-started the app (the plugin holds
  // it until a listener attaches) finds the habit or reminder it names.
  armNotificationActions();
}

/* What of the account shows on screen, to tell whether a fresh /me changed it. */
const accountShape = (u) =>
  JSON.stringify(u ? [u.displayName, u.timezone, u.features, u.navLayout, u.uiPrefs, u.level, u.xpTotal] : null);

/* The phone app has no service worker, so with no connection a cold start's
   wave 1 had nothing to answer it and Home was the crash card. The last good
   wave 1 (+ goals) is kept per account (session.js bootKey; every sign-out
   removes it) and painted instead, under the offline banner, or a toast when
   the device thinks it is online (a server that never answered). It counts as
   loaded, so coming back online refreshes in place. Web: the worker's
   gb-api-get already does this, so nothing is stored twice there. */
function saveBootSnapshot() {
  if (!isNative() || !state.user || !state.user.id) return;
  CacheStorage.setItem(bootKey(state.user.id), bootSnapshot(state));
}
async function paintBootSnapshot(userKey) {
  await CacheStorage.ready();
  const snap =
    state.user && state.user.id && readBootSnapshot(CacheStorage.getItem(bootKey(state.user.id)));
  if (!snap) return false;
  Object.assign(state, snap);
  alarmInputsLoaded = true;
  overlayOutbox();
  state.loading = false;
  loadedFor = userKey;
  if (!SELF_LOADING_SCREENS.has(state.screen)) render();
  if (navigator.onLine)
    pushToast('Couldn’t reach Growth Buddy. Showing your last data.', 'info', 5000);
  return true;
}

/* Screens that own their subtree: they fetch through their own api callbacks
   AND paint their own loading state, so they don't need wave 1 and can't
   survive a render() they didn't ask for. Mentor is deliberately absent — it
   has no loading paint of its own, so it keeps `mentorSkeleton()`. */
const SELF_LOADING_SCREENS = new Set(['family', 'circle']);
/* The account whose wave 1 has landed: a loadData() for it is a refresh. */
let loadedFor = null;
/* Reminders and habits came from the server or the boot snapshot (reSyncDeviceAlarms). */
let alarmInputsLoaded = false;
/* The account whose write-ahead leftovers this page has revived (once each). */
let revivedFor = null;

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
  const gen = sessionGen();
  connectWebSocket();
  // What the outbox holds as the logs are read. loadData's flushOutbox runs
  // alongside: a queued night it sends after the server read the logs, but
  // before they are laid over below, would be in neither the answer nor the
  // queue, and left the phone until the next load.
  const queuedAtRead = outbox.list();
  // A failed load used to look exactly like having no data: every one of these
  // caught to null, and the only trace was a console line nobody sees. Name what
  // didn't arrive and offer the retry. Not when offline (the banner says so), not
  // on 401 (that path signs the user out by itself), and not for an answer to a
  // session that has already ended.
  const missed = [];
  const soft = (label) => (err) => {
    if (navigator.onLine && !(err && (err.status === 401 || err.sessionEnded))) missed.push(label);
    return null;
  };
  try {
    // The account itself too: a reload boots from the cached session, so a name,
    // timezone, feature or preference changed on another device never arrived.
    // A pref save still out is laid over its answer (syncUserSession).
    const before = accountShape(state.user);
    const [goals, notifications, food, money, dailyLogs, photoHistory, weekly, me] =
      await Promise.all([
        api('/api/goals').catch(soft('goals')),
        api(notifPageUrl('all')).catch(soft('notifications')),
        api('/api/food').catch(soft('food')),
        api('/api/money', { onResponse: rememberMoneyVersion }).catch(soft('money')),
        api('/api/daily-logs?days=60').catch(soft('sleep and mood')),
        api('/api/food/photo-history').catch(soft('food photos')),
        api('/api/weekly-review').catch(soft('weekly reviews')),
        api('/api/auth/me').catch(() => null),
      ]);
    if (isStaleSession(gen)) return; // signed out meanwhile: none of this is the next account's
    if (me) syncUserSession(me);
    const accountChanged = !!me && accountShape(state.user) !== before;
    // What didn't arrive, for a screen to say so in place of its empty state (Money:
    // a failed load looked exactly like a first run once the toast went).
    state.loadFailed = new Set(missed);
    state.goalsFailed = missed.includes('goals'); // Goals' inline error card
    if (missed.length) {
      pushToast("Couldn't load your " + new Intl.ListFormat('en').format(missed) + '.', 'error', 8000, {
        label: 'Retry',
        run: () => loadSecondaryData(),
      });
    }

    if (goals) {
      state.goals = goals;
      saveBootSnapshot();
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
    if (notifications) {
      setNotifFirstPage(notifications);
      syncNotifBeyond();
    }
    if (food) {
      state.food = food;
      cacheFoodSummary(food);
    }
    if (money) {
      adoptServerMoney(money);
      cacheMoney();
      persistMoney(); // replays anything left unsaved by the last session
    }
    // Sleep/mood + trends live on the backend. Merge in the server data, keep
    // the local-only photo history, and mirror to cache for offline paint.
    if (dailyLogs) {
      const localWell = loadWellness();
      await CacheStorage.ready(); // the outbox reads as empty until it has hydrated
      if (isStaleSession(gen)) return;
      state.wellness = overlayQueuedWellness(
        {
          sleepByDate: dailyLogs.sleepByDate || {},
          moodByDate: dailyLogs.moodByDate || {},
          photoHistory: photoHistory != null ? photoHistory : localWell.photoHistory || [],
        },
        [...queuedAtRead, ...outbox.list()]
      );
      state.trends = { byDate: dailyLogs.byDate || {} };
      persistWellness();
      persistTrends();
      // Only now: before the server's nights are in, an empty day here may be
      // one already logged on another device, and this would overwrite it.
      autoLogSleep();
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
    // Boot's usual-drink-hours answer lands in this paint, not one of its own
    // (perf.e2e counts boot paints); a slow one still paints when it lands.
    if (waterHoursLoad) await Promise.race([waterHoursLoad, new Promise((r) => setTimeout(r, 1500))]);
    waterHoursLoad = null;
    if (isStaleSession(gen)) return;
    // Data is complete now, so achievement detection can baseline/fire safely.
    state.achReady = true;

    // (A block here used to PUT the cached money document, unconditionally, whenever
    // `money` came back null. A successful GET never returns null, so it only ever
    // ran when the request FAILED, and then overwrote whatever another device or a
    // WhatsApp "Mark as paid" had saved. Unsaved expenses now wait in the pending
    // ledger queue and replay on their own; nothing needs pushing here.)

    // Repaint the screen you are on when its own data just arrived, not only the one
    // you booted on: tapping Money right after sign-in kept its empty first paint
    // (every day "No log") until something else happened to redraw it.
    const arrived = { money: !!money, goals: !!goals, food: !!food };
    if (state.screen === bootScreen || arrived[state.screen]) render();
    else if (accountChanged && !SELF_LOADING_SCREENS.has(state.screen)) render();
    // Home's Outlook ranks insights off the same history Report loads. Once
    // per session (null until it lands; sign-out clears it); it repaints Home.
    if (!state.insightHistory) loadInsightHistory();
    // Whether Quick add's Photo can offer Groceries (snapRoutes).
    if (featureOn('family') && state.inFamily === undefined) {
      api('/api/family').then(noteFamily).catch(() => {});
    }
  } catch (err) {
    console.error('Secondary data load failed', err);
  }
}

/* ---- WebSocket: realtime notification push ---- */
/* Realtime bell notifications. `@stomp/stompjs` over the browser's own
   WebSocket, to the backend's plain (non-SockJS) /ws endpoint. sockjs-client
   used to sit underneath it: 47 KB of IE-era fallbacks, a `global` shim script
   in <head>, and an unload listener that kept every page out of the bf-cache.
   Imported dynamically so it lands after first paint instead of blocking it:
   nothing awaits this call, and a channel that opens a few hundred ms late is
   invisible.
   `connecting` guards the await window — without it two calls in quick
   succession both pass the `stomp` check before either has assigned it. */
let wsConnecting = false;

async function connectWebSocket() {
  if (!state.user || stomp || wsConnecting) return;
  const token = loadToken();
  if (!token) return;
  wsConnecting = true;
  try {
    const { Client: StompClient } = await import('@stomp/stompjs');
    // Logged out (or already connected) while the chunks were in flight.
    if (!state.user || stomp) return;
    let reconnect = false;
    stomp = new StompClient({
      // http(s)://host -> ws(s)://host/ws. API_BASE is '' when the API is this
      // origin (web, vite preview/dev proxy) and absolute in the Capacitor app,
      // whose own origin (https://localhost) is not the backend.
      brokerURL: (API_BASE || location.origin).replace(/^http/, 'ws') + '/ws',
      connectHeaders: { Authorization: 'Bearer ' + token },
      reconnectDelay: 5000,
      // Re-read the token before EVERY (re)connect. It used to be captured once
      // here, so after the session rotated (re-login, password change) the
      // socket reconnected every 5 s with a dead token, forever. No token at
      // all means signed out: stop instead of retrying.
      beforeConnect: (client) => {
        const current = loadToken();
        if (!current || !state.user) {
          if (stomp === client) stomp = null;
          client.deactivate();
          return;
        }
        client.connectHeaders = { Authorization: 'Bearer ' + current };
      },
      onConnect: () => {
        // Catch up on whatever arrived while the socket was down. It reconnects
        // on its own, but a reconnect only resumes the live feed — everything
        // delivered in the gap was pushed to a socket nobody was holding, and
        // the bell is built from pushes alone. A phone suspends the socket the
        // moment the screen locks, so that gap is every night.
        // Not on the first connect: loadSecondaryData fetched the list a moment
        // ago, and this made every boot ask twice. ponytail: a push landing in
        // the split second between that fetch and this subscribe waits for the
        // next reconnect or visibilitychange; close it with a since= cursor if
        // that ever matters.
        if (reconnect) refreshNotifications();
        reconnect = true;
        stomp.subscribe('/user/queue/notifications', (frame) => {
          try {
            const n = JSON.parse(frame.body);
            // Not a notification: "your family's data changed, refetch" (FamilyEvents
            // on the server). No bell card, no toast, no chime — the Family screen
            // listens and refreshes itself if it is open.
            if (n.kind === 'family_changed') {
              window.dispatchEvent(new CustomEvent('gb:family-changed', { detail: n }));
              return;
            }
            // Also not a notification: a line for a mentorship thread
            // (MentorshipEvents). An open chat sheet appends it; the bell card
            // for it arrives separately as an ordinary 'system' push.
            if (n.kind === 'mentorship_message') {
              window.dispatchEvent(new CustomEvent('gb:mentorship-message', { detail: n.message }));
              return;
            }
            // An invite answered, sent or ended changes the Circle screen's lists —
            // it refreshes itself if it is open (circle.js listens).
            if (n.kind && (n.kind.indexOf('mentorship_') === 0 || n.kind === 'system')) {
              window.dispatchEvent(new CustomEvent('gb:circle-changed', { detail: n }));
            }
            state.notifications = [n, ...state.notifications.filter((x) => x.id !== n.id)];
            // A card in a closed dropdown is not an alert, and a reminder that
            // arrives while you're using the app should still say something. The
            // toast is the "pop up"; repaintOverlays keeps the screen underneath
            // (and whatever you were doing on it) alive.
            repaintOverlays();
            // A reminder that can ring again offers to, right on the toast — and
            // stays a little longer, since it now asks for a decision.
            const snoozable = snoozableReminder(n);
            pushToast(
              n.title,
              n.kind === 'reminder' || n.kind === 'habit_reminder' ? 'info' : 'success',
              snoozable ? 10000 : 6000,
              snoozable
                ? { label: 'Snooze ' + minutesLabel(snoozeMinutes()), run: () => snoozeReminder(snoozable.id, null, n.id) }
                : null
            );
            playChime(notifySoundFor(n));
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

/* Everything a toggle's round trip can legitimately repaint: the score ring, the
   header's level, the ticks, their pills and sub-lines. The rest of what comes
   back (doneAt, updatedAt) lands in state and paints on the next render.

   render() replaces the whole app DOM, and after an optimistic paint the server
   almost always just confirms what is already on screen — so that second render
   showed up as a flicker a second after the tap: icons re-hydrating, the tick
   animation restarting, the scroll position re-applied. Compare this before and
   after instead, and skip the repaint when nothing actually moved. */
function toggleSignature() {
  const u = state.user || {};
  return JSON.stringify([
    state.score,
    // XP ticks up on every completion but is only on screen while the profile
    // popover is open — repainting the app for a number nobody can see is
    // exactly the flicker this removes. Level always counts: it gates the
    // level-up celebration.
    state.profileOpen ? u.xpTotal : 0,
    u.level,
    state.freezeTokens,
    (state.tasks || []).map((t) => [t.id, t.done, t.priority, t.time]),
    (state.habits || []).map((x) => [x.id, x.doneToday, x.streak]),
  ]);
}

/* Paint the tick, then tell the server. The round trip is two calls deep
   (toggle, then score + /me together), so awaiting it left the checkbox looking dead for
   most of a second. A failed toggle flips just that row back. */
/* One toggle per row in flight. A second tap before the first answered sent a
   second PATCH .../toggle; whichever response landed last won, so the row could
   settle opposite to the server, and a failed first call's rollback wiped the
   second tap too. A tap that's ignored here leaves Check's own guess un-rendered,
   and Check takes that back itself. */
const togglesInFlight = inFlightKeys();

/* The tick that finished a goal's last open linked task offers to close the
   goal: the same one-button toast a reminder's Snooze uses. On Goals the card's
   own "Everything here is done" line says it as well. */
function suggestGoalDone(taskId, tasksBefore) {
  const goals = (state.goals || []).flatMap((sec) => sec.goals || []);
  const goal = goalFinishedBy(taskId, tasksBefore, state.tasks, goals, effectiveGoalProgress());
  if (!goal) return;
  pushToast('That was the last task for “' + goal.title + '”.', 'info', 6000, {
    label: 'Mark goal done',
    run: () => {
      const g = (state.goals || []).flatMap((sec) => sec.goals || []).find((x) => x.id === goal.id);
      if (g && !g.completed) toggleGoal(goal.id);
    },
  });
}

/* A 404 on a task means it was deleted elsewhere: a retry can only 404 again,
   so the row goes instead of rolling back with "try again" (HOS-8). */
function taskGoneElsewhere(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  pushToast('That task was deleted on another device.', 'info', 4000);
}

async function toggleTask(id) {
  if (togglesInFlight.has(id)) return;
  togglesInFlight.add(id);
  const before = { score: state.score };
  let saved = false; // past this, the server has the tick: a failed score refresh mustn't undo it
  const tasksBefore = state.tasks;
  state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  state.score = optimisticScore();
  render();
  const nowDone = state.tasks.some((t) => t.id === id && t.done);
  suggestGoalDone(id, tasksBefore);
  // Only on the way to done. Un-ticking something is a correction, not an
  // achievement, and nodding at it would make the nod meaningless.
  if (nowDone) buddyReact('yes');
  // Offline (or a task whose create is still queued): the tick stays, the PATCH waits in the outbox.
  // One key for the live PATCH and its replay: a flip that landed unanswered must not flip back.
  const idemKey = newIdemKey();
  // The state the user saw and asked for, not a flip: a stale tab's tap on a task
  // done elsewhere used to un-do it (HOS-6). A server without the field ignores it.
  const op = {
    method: 'PATCH',
    path: '/api/tasks/' + encodeURIComponent(realId(id)) + '/toggle',
    body: { done: nowDone },
    kind: 'task.toggle',
    toggleKey: 'task:' + realId(id),
    local: { id },
    idemKey,
  };
  try {
    if (isTempId(realId(id))) {
      queueWrite(op);
      return;
    }
    const updated = await sendAhead(op, () =>
      api(op.path, { method: 'PATCH', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(op.body) })
    );
    const painted = toggleSignature();
    state.tasks = state.tasks.map((t) => (t.id === id || t.id === updated.id ? mapTask(updated) : t));
    saved = true;
    if (nowDone) celebrateMoment(tasksMoment(tasksForToday(state.tasks, new Date(), state.user && state.user.timezone), todayKey()));
    // Both only need the toggle landed, not each other: one round trip, not two.
    const [todayScore] = await Promise.all([api('/api/score/today'), refreshCurrentUser()]);
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
    if (toggleSignature() !== painted) render();
  } catch (err) {
    if (saved) {
      render();
      return;
    }
    if (err.queued) return;
    if (err.status === 404) {
      taskGoneElsewhere(id);
      state.score = before.score;
      render();
      return;
    }
    // Only this row: restoring the whole array undid any other row ticked meanwhile.
    state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    state.score = before.score;
    render();
    toastError(err, 'Could not toggle task.');
  } finally {
    togglesInFlight.delete(id);
  }
}

/* Same optimistic paint as toggleTask — same two-step round trip. Streak
   numbers are the server's to decide, so only `doneToday` flips locally. */
/* Ticking a measured habit asks what it measured. Tapping one that is already
   done reopens the same dialog with today's number in it, so a typo can be
   fixed; un-ticking is the dialog's own button there. A second tap used to
   un-tick straight away and throw the number out. */
async function toggleHabit(id) {
  const habit = (state.habits || []).find((x) => x.id === id);
  if (isQuitHabit(habit)) {
    if (togglesInFlight.has(id)) return;
    openSlipDialog(habit);
    return;
  }
  if (habit && habit.metric && habit.metric !== 'none') {
    if (togglesInFlight.has(id)) return;
    openMeasuredCheckin(habit);
    return;
  }
  return plainToggleHabit(id);
}

/* A day's note on a check-in (HabitCheckin.note, ≤2000 on the server). */
function habitNoteInput(value, placeholder) {
  const el = h('textarea', {
    class: 'gb-input',
    rows: '2',
    maxlength: '2000',
    placeholder: placeholder || 'How did it go? (optional)',
    'aria-label': 'Note for the day',
  });
  // A textarea's text is its value property, not an attribute.
  el.value = value || '';
  return el;
}

/* A quit habit's tap. Clean today: log a slip, with an optional note on what
   happened. Slipped: take it back (the note stays editable). Each goes through
   the dated check-in, `done: false` being the slip — no XP either way; clean
   days are paid once by the server when the day is over. */
function openSlipDialog(habit) {
  const slipped = !habit.doneToday;
  const note = habitNoteInput(habit.todayNote, 'What happened? Noting it helps spot the pattern.');
  const save = async (done) => {
    if (togglesInFlight.has(habit.id)) return;
    togglesInFlight.add(habit.id);
    let updated;
    try {
      updated = await api('/api/habits/' + encodeURIComponent(habit.id) + '/checkin', {
        method: 'POST',
        body: JSON.stringify({ date: accountTodayKey(), done, note: note.value.trim() }),
      });
    } finally {
      togglesInFlight.delete(habit.id);
    }
    state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
    if (done) buddyReact('yes');
    reSyncDeviceAlarms();
    refreshScoreLater();
    render();
  };
  openModal({
    title: habit.name,
    sub: slipped
      ? 'You logged a slip today. Take it back if it was a mistake.'
      : (Number(habit.streak) || 0) +
        ' days clean. Slipped? Log it honestly — the streak restarts tomorrow.',
    body: h('div', { class: 'gb-form' }, h('div', { class: 'gb-field-label' }, 'Note'), note),
    primary: slipped ? 'Save note' : 'I slipped',
    destructive: !slipped,
    errorMessage: 'Could not save that.',
    danger: slipped ? { label: 'Undo the slip', onClick: () => save(true) } : null,
    onPrimary: () => save(false),
  });
}

function openMeasuredCheckin(habit) {
  const editing = !!habit.doneToday;
  const valueInput = h('input', {
    type: 'number',
    class: 'gb-input',
    inputmode: 'decimal',
    min: '0',
    step: habit.metric === 'steps' ? '1' : '0.1',
    // Last time's number when there is one (any metric), else an example in
    // the habit's own unit: "e.g. 5.2" on a minutes habit read as kilometres.
    placeholder:
      habit.lastValue != null
        ? 'Last time ' + (Math.round(habit.lastValue * 10) / 10).toLocaleString()
        : habit.metric === 'steps'
          ? 'e.g. 6500'
          : habit.metric === 'minutes'
            ? 'e.g. 10'
            : 'e.g. 5.2',
    autofocus: true,
    // Not done yet: last time's number ("same as last time"), so a usual day is one tap.
    value: String((editing ? habit.todayValue : habit.metric !== 'steps' ? habit.lastValue : null) ?? ''),
  });
  // The phone already counted them: fill that in, but only until the user
  // touches the box, so nothing they type (or clear) is overwritten.
  // Last time's number stays a placeholder: filled in as a value it read as
  // today's count and got saved as one.
  if (habit.metric === 'steps' && !editing) {
    if (habit.lastValue != null) {
      valueInput.placeholder = 'Last time ' + Math.round(habit.lastValue).toLocaleString();
    }
    let touched = false;
    valueInput.addEventListener('input', () => (touched = true), { once: true });
    readTodaySteps().then((n) => {
      if (touched || valueInput.value !== '' || n == null) return;
      valueInput.value = String(n);
      if (document.activeElement === valueInput) valueInput.select();
      else valueInput.addEventListener('focus', () => valueInput.select(), { once: true });
    });
  }
  // Only where it means something: minutes against a distance give you a speed,
  // minutes against minutes is the same box twice.
  const durationInput =
    habit.metric === 'km'
      ? h('input', {
          type: 'number',
          class: 'gb-input',
          min: '1',
          max: '1440',
          step: '1',
          placeholder: habit.lastDurationMin ? 'Last time ' + habit.lastDurationMin : 'e.g. 26',
          value: String((editing ? habit.todayDurationMin : habit.lastDurationMin) ?? ''),
        })
      : null;
  // Today's note rides along (todayNote), so re-saving the number keeps it.
  const noteInput = habitNoteInput(editing ? habit.todayNote : '');

  openModal({
    title: habit.name,
    sub: editing
      ? 'Done today. Change the number, or un-tick it.'
      : 'Log today, or leave it blank — the tick counts either way.',
    body: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, METRIC_LABEL[habit.metric] || 'Amount'),
      valueInput,
      ...(durationInput
        ? [h('div', { class: 'gb-field-label' }, 'Minutes (optional)'), durationInput]
        : []),
      h('div', { class: 'gb-field-label' }, 'Note (optional)'),
      noteInput
    ),
    primary: editing ? 'Save' : 'Mark done',
    errorMessage: 'Could not save that check-in.',
    // Closes first, then un-ticks through the ordinary toggle (optimistic paint,
    // score refresh). Un-ticking clears the day's number on the server.
    danger: editing ? { label: 'Un-tick today', onClick: () => plainToggleHabit(habit.id) } : null,
    onPrimary: async () => {
      // One save at a time per habit, shared with the plain toggle: Enter plus a
      // click, or a tick on Home while this was saving, sent two check-ins.
      if (togglesInFlight.has(habit.id)) return;
      const raw = valueInput.value.trim();
      const value = raw === '' ? null : Number(raw);
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        valueInput.focus();
        throw new Error('Enter a number, or leave it blank.');
      }
      const mins = durationInput && durationInput.value.trim() !== '' ? Number(durationInput.value) : null;
      if (mins != null && (!Number.isFinite(mins) || mins < 1 || mins > 1440)) {
        durationInput.focus();
        throw new Error('Minutes must be between 1 and 1440.');
      }
      togglesInFlight.add(habit.id);
      let updated;
      try {
        updated = await api('/api/habits/' + encodeURIComponent(habit.id) + '/checkin', {
          method: 'POST',
          body: JSON.stringify({
            done: true,
            value,
            durationMin: mins,
            note: noteInput.value.trim(),
          }),
        });
      } finally {
        togglesInFlight.delete(habit.id);
      }
      state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
      reconcileStreakFreeze(updated);
      if (!editing) buddyReact('yes');
      reSyncDeviceAlarms();
      // The dialog closes on the check-in; score and XP land after it, together.
      // Awaiting them in series held it open for two more round trips.
      const before = state.score;
      Promise.all([refreshScore(), refreshCurrentUser()]).then(() => {
        if (state.score !== before || !editing) render();
      });
    },
  });
}

/* moments.js: the popup for a small win, each once a day. Memory only: a reload
   can show one again, which costs nothing. */
const shownMoments = new Set();
function celebrateMoment(m) {
  if (!m || shownMoments.has(m.key)) return false;
  shownMoments.add(m.key);
  celebrate(m);
  return true;
}

async function plainToggleHabit(id) {
  if (!togglesInFlight.claim(id)) return;
  const before = { score: state.score };
  let saved = false;
  // Ticking a rest day hands its freeze back (the server refunds it).
  const wasRest = state.habits.some((h) => h.id === id && h.protectedToday && !h.doneToday);
  const tokensBefore = freezeTokensLeft();
  state.habits = state.habits.map((h) => (h.id === id ? { ...h, doneToday: !h.doneToday } : h));
  state.score = optimisticScore();
  render();
  if (state.habits.some((h) => h.id === id && h.doneToday)) buddyReact('yes');
  // Queued (write-ahead, and on no response) as a dated check-in, not /toggle:
  // the server's "today" when this replays may be tomorrow, and a toggle would
  // tick the wrong day. It also sets, not flips, so replaying one that landed
  // changes nothing. Two taps on the same day cancel in the outbox (toggleKey).
  const day = todayKey();
  const done = state.habits.some((h) => h.id === id && h.doneToday);
  const op = {
    method: 'POST',
    path: '/api/habits/' + encodeURIComponent(id) + '/checkin',
    body: { date: day, done },
    kind: 'habit.checkin',
    toggleKey: 'habit:' + id + ':' + day,
    local: { id, day, done },
  };
  // A check-in for this day still queued (its flush stalled): a live /toggle
  // would flip the server from its pre-queue state, the opposite of this tap.
  // Queue it too; the pair cancels.
  if (outbox.list().some((o) => !o.live && o.toggleKey === op.toggleKey)) {
    queueWrite(op);
    reSyncDeviceAlarms();
    togglesInFlight.delete(id);
    return;
  }
  try {
    const updated = await sendAhead(op, () =>
      api('/api/habits/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH', body: JSON.stringify({ done }) })
    );
    const painted = toggleSignature();
    state.habits = state.habits.map((h) => (h.id === updated.id ? updated : h));
    saved = true;
    reconcileStreakFreeze(updated);
    celebrateMoment(habitMoment(updated, state.habits, todayKey()));
    // Said only when the count really went back up, not on the hope it did.
    if (wasRest && updated.doneToday && freezeTokensLeft() > tokensBefore) {
      toastSuccess('Done. Freeze returned, ' + freezeTokensLeft() + ' left.');
    }
    // Both only need the toggle landed, not each other: one round trip, not two.
    const [todayScore] = await Promise.all([api('/api/score/today'), refreshCurrentUser()]);
    state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
    if (toggleSignature() !== painted) render();
    reSyncDeviceAlarms();
  } catch (err) {
    if (saved) {
      render();
      reSyncDeviceAlarms();
      return;
    }
    if (err.queued) {
      reSyncDeviceAlarms();
      return;
    }
    state.habits = state.habits.map((h) => (h.id === id ? { ...h, doneToday: !h.doneToday } : h));
    state.score = before.score;
    render();
    toastError(err, 'Could not toggle habit.');
    reSyncDeviceAlarms();
  } finally {
    togglesInFlight.delete(id);
  }
}

/* ---- Habits that tick themselves ----
   A Steps habit whose name gives a target ("Walk 8k steps", stepsTarget) ticks
   once the phone's own count reaches it; a focus habit ("Deep work 2h",
   focusMinutesTarget) once today's focus minutes do. Same dated check-in as a
   manual tick, with the number, and Undo on the toast. Tried once per habit per
   day, so an Undo is never re-ticked behind the user's back. */
const autoTickTried = new Set(); // 'habitId|YYYY-MM-DD'
async function autoTickHabit(habit, value, why) {
  const day = accountTodayKey();
  const key = habit.id + '|' + day;
  if (autoTickTried.has(key) || habit.doneToday || isQuitHabit(habit) || !habitDue(habit)) return;
  if (togglesInFlight.has(habit.id)) return;
  autoTickTried.add(key);
  togglesInFlight.add(habit.id);
  let updated;
  try {
    updated = await api('/api/habits/' + encodeURIComponent(habit.id) + '/checkin', {
      method: 'POST',
      body: JSON.stringify({
        date: day,
        done: true,
        value: habit.metric && habit.metric !== 'none' ? value : null,
      }),
    });
  } catch (_) {
    return; // nothing changed; the user can still tick it themselves
  } finally {
    togglesInFlight.delete(habit.id);
  }
  state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
  reconcileStreakFreeze(updated);
  reSyncDeviceAlarms();
  refreshScoreLater();
  render();
  pushToast(habit.name + ' ticked: ' + why + '.', 'success', 6000, {
    label: 'Undo',
    run: () => plainToggleHabit(habit.id),
  });
}

/* Habits linked to a health reading (healthLink + healthTarget) tick
   themselves once today's reading reaches the target. Steps, distance,
   calories, floors and workouts come from the phone (null on the web); sleep
   comes from today's sleep entry, which autoLogSleep fills from the phone and
   the user can edit by hand, so an edited night counts as edited. An older
   Steps habit with no link still ticks off the target in its name. Run after a
   load, on coming back to the app, and after a sleep save. Ticking goes
   through autoTickHabit: once per habit per day, with Undo on the toast. */
async function autoTickHealthHabits() {
  if (!featureOn('habits')) return;
  const linkOf = (hb) => hb.healthLink || (hb.metric === 'steps' && stepsTarget(hb.name) != null ? 'steps' : null);
  const open = (state.habits || []).filter((hb) => !hb.doneToday && hb.active !== false && linkOf(hb));
  if (!open.length) return;
  const values = {};
  await Promise.all(
    [...new Set(open.map(linkOf))].map(async (link) => {
      values[link] =
        link === 'sleep' ? sleepHours((state.wellness.sleepByDate || {})[todayKey()]) : await healthTodayValue(link);
    })
  );
  // A habit that records a number gets the reading when it is the same thing.
  const SAME = { steps: 'steps', distance: 'km', workout: 'minutes' };
  open.forEach((hb) => {
    const link = linkOf(hb);
    const target = hb.healthLink ? Number(hb.healthTarget) : stepsTarget(hb.name);
    const v = values[link];
    if (v == null || !(target > 0) || v < target) return;
    const L = HEALTH_LINKS[link];
    const why = link === 'sleep' ? v + ' h of sleep' : v.toLocaleString() + ' ' + L.unit + ' on your phone';
    autoTickHabit(hb, SAME[link] === hb.metric ? v : null, why);
  });
}

/* Last night from the phone's health store, saved as today's sleep when none is
   logged yet: a watch or a sleep-tracking phone already knows when you slept.
   Quality stays 'okay' (the store has no opinion); the sleep dialog edits it.
   Never asks for access (readLastNight only reads), so it is safe on every
   load and resume. One read in flight at a time. */
let sleepReadInFlight = false;
async function autoLogSleep() {
  const today = todayKey();
  if (sleepReadInFlight || !state.user) return;
  // Already logged: nothing to read, but a sleep-linked habit still checks it.
  if ((state.wellness.sleepByDate || {})[today]) return autoTickHealthHabits();
  sleepReadInFlight = true;
  try {
    const night = await readLastNight();
    // Typed in by hand while the store answered: that one stands.
    if (!night || (state.wellness.sleepByDate || {})[today]) return;
    await saveSleepEntry({ date: today, bedtime: night.bedtime, wakeTime: night.wakeTime, quality: 'okay' });
  } finally {
    sleepReadInFlight = false;
  }
}

/* Health readings: typed in by hand, or synced from the phone's health store
   (/api/health/*, HealthReadingService). The Health screen draws them; linked
   habits count today's. Loaded on opening Health, and at boot when a habit
   links to one, never cached locally: the server's copy is the only one. */
const health = { readings: null, loading: false, available: null, syncing: false, syncedAt: null };
const healthDays = 90;

async function loadHealthReadings() {
  if (health.loading || !state.user) return;
  health.loading = true;
  try {
    health.readings = await api('/api/health/readings?days=' + healthDays);
    autoTickHealthHabits(); // a walk typed in on another device counts here too
  } catch (err) {
    if (health.readings == null) health.readings = [];
    if (state.screen === 'health') toastError(err, 'Could not load your health readings.');
  } finally {
    health.loading = false;
    if (state.screen === 'health') render();
  }
}

/* The phone's last 7 days to the account, each time the app opens: boot and
   resume (visibilitychange), plus the Health screen's Sync button (`force`:
   says when it fails). Never opens a permission sheet (readHealthForSync only
   reads); the POST is a per-day upsert, so a repeat costs nothing. */
async function syncHealthFromPhone({ force = false } = {}) {
  if (!isNative() || !state.user || health.syncing) return;
  health.syncing = true;
  if (state.screen === 'health') render();
  try {
    health.available = await healthAvailable();
    const rows = health.available ? await readHealthForSync(7) : null;
    if (rows && rows.length) await api('/api/health/sync', { method: 'POST', body: JSON.stringify({ readings: rows }) });
    if (rows) health.syncedAt = new Date();
    if (rows && rows.length) await loadHealthReadings();
  } catch (err) {
    if (force) toastError(err, 'Could not sync from your phone.');
  } finally {
    health.syncing = false;
    if (state.screen === 'health') render();
  }
  autoTickHealthHabits();
}

async function connectHealth() {
  if (!(await requestHealthAccess())) {
    pushToast(
      /android/i.test(navigator.userAgent)
        ? 'Health Connect isn’t available. Install or update it from the Play Store.'
        : 'Health data isn’t available on this device.',
      'error',
      4200
    );
    return;
  }
  autoLogSleep();
  await syncHealthFromPhone({ force: true });
}

/* Hand-typed readings. Each resolves once the server has it, then repaints;
   the sheet that called it closes on success and shows the refusal otherwise. */
async function saveHealthReading(reading) {
  const saved = await api('/api/health/readings', { method: 'POST', body: JSON.stringify(reading) });
  health.readings = [saved, ...(health.readings || [])];
  toastSuccess('Reading saved.');
  render();
  autoTickHealthHabits();
}
async function updateHealthReading(id, patch) {
  const saved = await api('/api/health/readings/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) });
  health.readings = (health.readings || []).map((r) => (r.id === id ? saved : r));
  toastSuccess('Reading updated.');
  render();
  autoTickHealthHabits();
}
async function deleteHealthReading(id) {
  await api('/api/health/readings/' + encodeURIComponent(id), { method: 'DELETE' });
  health.readings = (health.readings || []).filter((r) => r.id !== id);
  toastSuccess('Reading deleted.');
  render();
}

/* Today's value for a habit's health link: what the phone says now (or its
   last sync, off the phone) plus everything typed in by hand today. */
async function healthTodayValue(link) {
  const day = todayKey();
  const rows = (health.readings || []).filter((r) => r.type === link && r.day === day);
  const phoneRow = rows.filter((r) => r.source === 'phone').reduce((n, r) => Math.max(n, Number(r.value || 0)), 0);
  const typed = rows.filter((r) => r.source !== 'phone').reduce((n, r) => n + Number(r.value || 0), 0);
  const live = isNative() ? await readHealthValue(link) : null;
  const total = (live != null ? live : phoneRow) + typed;
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

/* Last night from the phone's health store, for Home's "Save it?" row. Memory
   only: the user's tap is what saves it. Read through a dynamic import so a
   native.js without readLastNight (no health build) just means no phone row.
   Stamped with today, so a night read before midnight is never offered as the
   next one. Skipped while the Sleep & mood card is hidden: the read can open the
   health permission sheet, and nothing would show its answer.
   ponytail: read once per load/resume */
async function loadPhoneNight() {
  const today = todayKey();
  if (((state.wellness && state.wellness.sleepByDate) || {})[today]) return;
  const card = resolveHomeLayout(state.user && state.user.homeLayout).find((w) => w.id === 'wellness');
  if (!card || !card.enabled) return;
  try {
    const { readLastNight } = await import('./native.js');
    if (typeof readLastNight !== 'function') return;
    const night = await readLastNight();
    state.phoneNight = night ? { ...night, date: today } : null;
    if (state.phoneNight) render();
  } catch (_) {
    // No health store or access: the guess falls back to the logged nights.
  }
}

/* After a saved focus session: today's focus minutes from the server, so two
   sessions on two devices add up. */
async function autoTickFocusHabits() {
  if (!featureOn('habits')) return;
  const open = (state.habits || []).filter((hb) => !hb.doneToday && focusMinutesTarget(hb.name) != null);
  if (!open.length) return;
  const stats = await api('/api/focus/stats').catch(() => null);
  const mins = stats && Number(stats.todayMinutes);
  if (!(mins > 0)) return;
  open
    .filter((hb) => mins >= focusMinutesTarget(hb.name))
    .forEach((hb) => autoTickHabit(hb, hb.metric === 'minutes' ? mins : null, mins + ' focus minutes today'));
}

/* The Save money pack's "Log every expense" (or any habit named for logging
   expenses) ticks when an expense for today is saved, from any path: saveMoney. */
const LOGS_EXPENSES = /\blog\b.*\bexpenses?\b/i;
function autoTickExpenseHabits() {
  if (!featureOn('habits')) return;
  (state.habits || [])
    .filter((hb) => !hb.doneToday && hb.active !== false && LOGS_EXPENSES.test(hb.name || ''))
    .forEach((hb) => autoTickHabit(hb, null, 'an expense logged'));
}

async function refreshScore() {
  try {
    const s = await api('/api/score/today');
    if (s && typeof s.score === 'number') state.score = s.score;
  } catch (_) {
    /* silent */
  }
}

/* The ring is the only thing a create changes besides its own list, so a
   dialog closes on the create and the score lands after it. Awaiting it held
   every New task / habit / goal dialog open for a second round trip. */
function refreshScoreLater() {
  const before = state.score;
  refreshScore().then(() => {
    if (state.score !== before) render();
  });
}

async function refreshCurrentUser() {
  try {
    const me = await api('/api/auth/me');
    syncUserSession(me || {});
  } catch (_) {
    /* silent */
  }
}

/* Returns the task; `queued: true` when it went into the outbox, so the caller's
   "Task added." doesn't sit on top of "Saved on this phone", saying it twice. */
async function createTask(body) {
  let created;
  const idemKey = newIdemKey(); // this tap, live or replayed
  const local = mapTask({ ...body, id: tempId(), done: false, paused: false });
  try {
    created = await sendAhead(
      { method: 'POST', path: '/api/tasks', body, kind: 'task.create', tempId: local.id, local, idemKey },
      () =>
        api('/api/tasks', {
          method: 'POST',
          headers: { 'Idempotency-Key': idemKey },
          body: JSON.stringify(body),
        })
    );
  } catch (err) {
    if (!err.queued) throw err;
    // Offline: the row goes in now under a temp id; the POST waits in the outbox.
    state.tasks = [local, ...state.tasks];
    landSoon('[data-task-id="' + local.id + '"]');
    return { ...local, queued: true };
  }
  const task = mapTask(created);
  state.tasks = [task, ...state.tasks];
  landSoon('[data-task-id="' + created.id + '"]');
  refreshScoreLater();
  return task;
}

/* An edit queues offline like the create does (it used to be refused while a
   new task was "saved on this phone"): painted now, sent in order behind it. */
async function updateTask(id, body) {
  const path = '/api/tasks/' + encodeURIComponent(realId(id));
  const idemKey = newIdemKey();
  const op = { method: 'PUT', path, body, kind: 'task.update', local: { ...body, id }, idemKey };
  let updated;
  try {
    if (isTempId(realId(id))) {
      await queueWrite(op);
      throw Object.assign(new Error('queued'), { queued: true });
    }
    updated = await sendAhead(op, () =>
      api(path, { method: 'PUT', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(body) })
    );
  } catch (err) {
    if (err.status === 404) return taskGoneElsewhere(id); // the dialog closes on it
    if (!err.queued) throw err;
    state.tasks = state.tasks.map((t) => (t.id === id ? mapTask({ ...t, ...body, id }) : t));
    return;
  }
  state.tasks = state.tasks.map((t) => (t.id === updated.id || t.id === id ? mapTask(updated) : t));
  landSoon('[data-task-id="' + updated.id + '"]');
  refreshScoreLater();
}

/* A one-field change to a task painted before it is sent (pause): the
   button used to sit there for the round trip. A second change to the same task
   while one is in flight is dropped; a failure puts back just that task. */
async function patchTaskNow(id, patch, errorMessage) {
  const key = 'patch:' + id;
  if (togglesInFlight.has(key)) return false;
  const prev = state.tasks.find((t) => t.id === id);
  if (!prev) return false;
  if (isTempId(realId(id))) return toastError(null, STILL_SYNCING), false;
  togglesInFlight.add(key);
  state.tasks = state.tasks.map((t) => (t.id === id ? mapTask({ ...t, ...patch }) : t));
  render();
  try {
    const updated = await api('/api/tasks/' + encodeURIComponent(realId(id)), {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    state.tasks = state.tasks.map((t) => (t.id === updated.id || t.id === id ? mapTask(updated) : t));
    render();
    refreshScoreLater();
    return true;
  } catch (err) {
    state.tasks = state.tasks.map((t) => (t.id === id ? prev : t));
    render();
    toastError(err, errorMessage);
    return false;
  } finally {
    togglesInFlight.delete(key);
  }
}

function pauseTask(task) {
  return patchTaskNow(task.id, { paused: !task.paused }, 'Could not update task.');
}

/* Undoable (deferDelete): the row goes now, the DELETE when the toast does. */
function deleteTask(id) {
  if (!state.tasks.some((t) => t.id === id)) return;
  deferDelete({
    message: 'Task deleted.',
    errorText: 'Could not delete that task.',
    selector: '[data-task-id="' + id + '"]',
    ...listSlot(() => state.tasks, (l) => (state.tasks = l), id),
    commit: () => sendTaskDelete(id),
  });
}

async function sendTaskDelete(id) {
  // realId at send time: a create that was queued may have landed in the window.
  const path = '/api/tasks/' + encodeURIComponent(realId(id));
  const idemKey = newIdemKey();
  const op = { method: 'DELETE', path, kind: 'task.delete', local: { id }, idemKey };
  if (isTempId(realId(id))) await queueWrite(op); // its create is still queued: both are cancelled
  else
    try {
      await sendAhead(op, () => api(path, { method: 'DELETE', keepalive: true, headers: { 'Idempotency-Key': idemKey } }));
    } catch (err) {
      if (!err.queued) throw err;
    }
  if (state.user) refreshScoreLater();
}

/* A plain daily habit by name, for Circle's shared goal and Report's weekly
   focus. Resolves false, adding nothing, when one of that name exists. */
function addHabitNamed(name) {
  const key = name.trim().toLowerCase();
  if (state.habits.some((x) => String(x.name || '').trim().toLowerCase() === key)) return Promise.resolve(false);
  return createHabit({ name: name.trim(), domain: 'habit', icon: 'repeat', cadence: 'daily', metric: 'none' });
}

async function createHabit(body) {
  const created = await api('/api/habits', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // At the bottom, where the server files it (sort_order = last + 1): put on
  // top here, it jumped down on the next load.
  state.habits = [...state.habits, created];
  refreshScoreLater();
  reSyncDeviceAlarms();
  askPushOnce(!!body.reminderTime);
  return created; // the "Remind you at HH:MM?" offer reads it
}

/* ---- Habit order (PUT /api/habits/order) ----
   Move up / move down on the Habits screen in reorder mode. Optimistic: the
   list moves at once, and each save sends the whole order, so saves are
   chained — two quick taps landing out of order would leave the first one's
   order on the server. A failure puts back the order from before that tap. */
let habitReorderMode = false;
let habitOrderQueue = Promise.resolve();

function moveHabit(id, delta) {
  const list = state.habits.slice();
  const from = list.findIndex((x) => x.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  const before = state.habits;
  [list[from], list[to]] = [list[to], list[from]];
  state.habits = list;
  render();
  // Keep the keyboard on the arrow just used, now on the moved row.
  refocusMoveButton(id, delta);
  const ids = list.map((x) => x.id);
  habitOrderQueue = habitOrderQueue
    .then(() =>
      api('/api/habits/order', { method: 'PUT', body: JSON.stringify({ ids }) })
    )
    .then(
      () => announce('Moved ' + (list[to].name || 'habit') + ' to position ' + (to + 1) + '.'),
      (err) => {
        // Only if nothing else moved since: a later tap's order supersedes this one.
        if (state.habits.map((x) => x.id).join() === ids.join()) {
          state.habits = before;
          render();
        }
        toastError(err, 'Could not save the new order.');
      }
    );
}

function refocusMoveButton(id, delta) {
  requestAnimationFrame(() => {
    const sel = '[data-habit-move="' + id + ':' + (delta < 0 ? 'up' : 'down') + '"]';
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) btn.focus();
    else {
      const other = document.querySelector(
        '[data-habit-move="' + id + ':' + (delta < 0 ? 'down' : 'up') + '"]'
      );
      if (other) other.focus();
    }
  });
}

async function updateHabit(id, body) {
  const updated = await api('/api/habits/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  state.habits = state.habits.map((x) => (x.id === id ? updated : x));
  reSyncDeviceAlarms();
  askPushOnce(!!body.reminderTime);
}

/* ---- Natural-language quick-add ----
   Send the raw text (+ the user's habit names for matching) to the backend
   parser, then apply each returned intent using the same handlers the manual
   UI uses. Returns a summary so the caller can confirm what landed. */
/* "Slept 7h" on top of what that day already holds: the logged wake time
   (else the usual one) anchors the duration, and a logged night keeps its
   quality and note (sleepFromHours, nudges.js). It used to invent a 07:00 wake
   and overwrite the night (FRC-2). */
function quickSleepPayload(it) {
  const day = intentDay(it, todayKey());
  const sleep = state.wellness.sleepByDate || {};
  return { ...sleepFromHours(it.hours, it.quality, sleep[day], usualSleep(sleep, day)), date: day };
}
const newMoneyId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
/* Booked as Money's own form would: its date, the default account (so the
   balance moves), a named currency converted (quick-add.js quickMoney). Returns
   the new id, for Undo. */
function addQuickExpense(it) {
  const base = state.money;
  const next = normalizeMoney(base);
  const q = quickMoney(base, it, 'expense', todayKey());
  const note = capitalise(String(it.note || '').trim());
  const id = newMoneyId();
  next.expenses.unshift({
    id,
    amount: q.amount,
    ...(q.orig ? { orig: q.orig } : {}),
    // The tag Money's own form would start on: this note's past tag, then keywords.
    // Then the user's fixed default tag (Money settings), then Others.
    category: quickCategory(base, note && suggestCategory(note, base)),
    date: q.date,
    note,
    createdAt: Date.now(),
    ...(q.accountId ? { accountId: q.accountId } : {}),
  });
  if (q.accountId) next.settings.lastAccountId = q.accountId;
  saveMoney(next, base);
  return id;
}
function addQuickIncome(it) {
  const base = state.money;
  const next = normalizeMoney(base);
  const label = capitalise(String(it.note || '').trim());
  const salary = /salary/i.test(label);
  const q = quickMoney(base, it, 'income', todayKey());
  const id = newMoneyId();
  (next.income = next.income || []).unshift({
    id,
    amount: q.amount,
    ...(q.orig ? { orig: q.orig } : {}),
    source: salary ? 'salary' : 'other',
    label: label || (salary ? 'Salary' : 'Income'),
    date: q.date,
    ...(q.accountId ? { accountId: q.accountId } : {}),
  });
  saveMoney(next, base);
  return id;
}
/* Quick add's Undo for what it put in Money. */
function removeQuickMoney(ids) {
  const base = state.money;
  const next = normalizeMoney(base);
  next.expenses = next.expenses.filter((x) => !ids.has(x.id));
  next.income = (next.income || []).filter((x) => !ids.has(x.id));
  saveMoney(next, base);
}
/* Read the sentence; write nothing. Applying straight from the parse meant one
   misread — "spent 200 on lunch" landing as 200ml of water — wrote itself into a
   tracker with no way to see it coming or take it back. */
async function parseQuickAdd(text) {
  const habits = (state.habits || [])
    .map((hb) => hb.name)
    .filter(Boolean)
    .slice(0, 100);
  // The account's date and clock, as one pair: what "tomorrow" and "in 20
  // minutes" mean where its reminders ring. The device clock beside the
  // account's day read "at 9" against the wrong hour for part of every night.
  const res = await api('/api/quick-add', {
    method: 'POST',
    body: JSON.stringify({ text, habits, today: todayKey(), now: accountNowHHMM() }),
  });
  // A sentence can't write into a tracker the user switched off, and the
  // preview says which were dropped. Model text loses its emoji here, so what
  // the preview shows is what gets saved.
  const intents = [];
  const skipped = [];
  ((res && res.intents) || []).forEach((raw) => {
    const it = {};
    for (const k in raw) it[k] = typeof raw[k] === 'string' ? stripEmoji(raw[k]) : raw[k];
    const feat = INTENT_FEATURE[it.type];
    if (!feat || featureOn(feat)) intents.push(settleIntent(it, text));
    else skipped.push(skippedLine(feat, it.type));
  });
  const out = { intents, skipped: [...new Set(skipped)] };
  // No model (or it failed): the server's plain patterns may still have read it.
  if (!res || res.configured === false) return { ...out, configured: false, fallback: true };
  if (res.unavailable) return { ...out, configured: true, unavailable: true, fallback: true };
  // Today's AI budget is spent: the server read it with its plain patterns.
  // A success, said quietly — not an error.
  if (res.limited) return { ...out, configured: true, limited: true, fallback: true };
  // res.note is not passed on: the model writes it in the past tense ("Logged
  // ...") above a preview nothing has been logged from yet.
  return { ...out, configured: true };
}

/* What the sentence said, not what the parser filled in. The server answers a
   mood's energy as medium when the words name none, which overwrote a logged
   energy (FRC-2), so medium counts only when the words say it. A one-off
   reminder at an hour already gone today is tomorrow's (EXS-5: it was refused,
   with two toasts). A task's "tomorrow 5pm" is its due time, read as the task
   dialog reads it (parseWhen). */
// ponytail: QuickAddService could send null for an unstated energy; then the
// first check goes.
function settleIntent(it, text) {
  if (it.type === 'mood' && it.energy === 'medium' && !/\b(medium|normal|average)\b/i.test(text))
    return { ...it, energy: null };
  if (it.type === 'reminder' && (it.repeat || 'none') === 'none') {
    const day = it.date || todayKey();
    if (day === todayKey() && isPastSlot(day, hhmm(it.time)))
      return { ...it, date: keyOfDate(new Date(Date.now() + 864e5)) };
  }
  if (it.type === 'task' && it.title && !it.dueAt) {
    const when = parseWhen(it.title);
    if (when) return { ...it, title: when.rest, dueAt: when.at.toISOString() };
  }
  return it;
}

/* "Money Buddy is off, so the expense was skipped." */
const INTENT_NOUN = {
  habit: 'habit tick',
  habit_new: 'new habit',
  water: 'water',
  expense: 'expense',
  income: 'income',
  food: 'food',
  goal: 'goal',
  note: 'note',
  reminder: 'reminder',
  focus: 'focus session',
};
function skippedLine(feat, type) {
  const def = FEATURE_DEFS.find((f) => f.key === feat);
  return (def ? def.label : feat) + ' is off, so the ' + (INTENT_NOUN[type] || type) + ' was skipped.';
}

/* Intent type -> the feature toggle it writes into (QuickAddApplier.FEATURE). */
const INTENT_FEATURE = {
  habit: 'habits',
  habit_new: 'habits',
  water: 'water',
  expense: 'money',
  income: 'money',
  food: 'food',
  goal: 'goals',
  note: 'notes',
  reminder: 'calendar',
  focus: 'focus',
};

/* Controls act on the app rather than log anything, so a sentence made only of
   them ("open money", "dark mode", "start a focus") runs without a preview. */
const CONTROL_INTENTS = new Set(['open', 'focus', 'setting']);
const SCREEN_LABEL = {
  home: 'Home',
  money: 'Money',
  calendar: 'Calendar',
  notes: 'Notes',
  goals: 'Goals',
  habits: 'Habits',
  food: 'Food',
  summary: 'Food summary',
  focus: 'Focus',
  report: 'Report',
  health: 'Health',
  family: 'Family',
  circle: 'Circle',
  mentor: 'Buddy',
  achievements: 'Achievements',
  settings: 'Settings',
};

/* The open task a "done with …" means: same title, else one inside the other,
   the closest length winning (TaskService.bestMatch). */
function matchOpenTask(words) {
  const w = String(words || '').trim().toLowerCase();
  if (!w) return null;
  let best = null;
  let bestScore = Infinity;
  (state.tasks || []).forEach((t) => {
    const title = String(t.title || '').trim().toLowerCase();
    if (t.done || !title) return;
    const score =
      title === w ? 0 : title.includes(w) || w.includes(title) ? 1 + Math.abs(title.length - w.length) : Infinity;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  });
  return best;
}

/* One intent, in the words the user would use. This is what they are agreeing
   to, so it has to name the tracker and the number, not the intent's shape. */
function describeIntent(it) {
  switch (it.type) {
    case 'task':
      return {
        icon: 'list-checks',
        label: 'New task',
        detail: it.title + (it.dueAt ? ' \u00b7 due ' + dueLabel(new Date(it.dueAt)) : ''),
      };
    case 'habit': {
      const known = (state.habits || []).some(
        (x) => (x.name || '').toLowerCase() === String(it.name || '').toLowerCase()
      );
      return {
        icon: 'repeat',
        label: known ? 'Tick habit' : 'No such habit',
        detail: it.name,
        unknown: !known,
      };
    }
    case 'water':
      return { icon: 'droplets', label: 'Water', detail: it.amountMl + ' ml' };
    case 'sleep': {
      // The night it will save, and what it replaces when one is logged (FRC-2).
      // Quality only when the user gave one or the night had one.
      const p = quickSleepPayload(it);
      const was = (state.wellness.sleepByDate || {})[p.date];
      const span = (e) => formatTime(hhmm(e.bedtime)) + ' to ' + formatTime(hhmm(e.wakeTime));
      return {
        icon: 'moon',
        label: 'Sleep',
        detail: withDay(
          it.hours + ' h \u00b7 ' + span(p) + (p.quality ? ' \u00b7 ' + p.quality : '') +
            (was && was.bedtime && was.wakeTime ? ' \u00b7 replaces ' + span(was) : ''),
          it
        ),
      };
    }
    case 'mood':
      return {
        icon: 'heart',
        label: 'Mood',
        detail: it.mood + (it.energy ? ' · ' + it.energy + ' energy' : ''),
      };
    case 'reminder':
      return { icon: 'bell', label: 'Reminder', detail: reminderSummary(it) };
    case 'expense':
    case 'income': {
      // Money's own formatting; a foreign amount with no rate set is shown as
      // such and starts unticked, so it is never booked 1:1 unseen.
      const q = quickMoney(state.money, it, it.type, todayKey());
      const note = capitalise(String(it.note || '').trim());
      // The account it will move, as Money's own form would pick it.
      const acc = q.accountId && ((state.money && state.money.accounts) || []).find((a) => a.id === q.accountId);
      return {
        icon: 'wallet',
        label: it.type === 'expense' ? 'Expense' : 'Income',
        detail: withDay(q.label + (note ? ' · ' + note : '') + (acc && acc.name ? ' · ' + acc.name : ''), it),
        unticked: !!q.noRate,
        // The symbol a rate is missing for: the preview offers to set it.
        noRate: q.noRate ? currencySymbol(String(it.currency).toUpperCase()) : null,
      };
    }
    case 'task_done': {
      const t = matchOpenTask(it.title);
      return t
        ? { icon: 'check', label: 'Finish task', detail: t.title }
        : { icon: 'check', label: 'No such open task', detail: it.title, unknown: true };
    }
    case 'habit_new':
      return { icon: 'repeat', label: 'New habit', detail: it.name };
    case 'goal':
      return { icon: 'target', label: 'New goal', detail: it.title };
    case 'food':
      return {
        icon: 'utensils',
        label: 'Food',
        detail: withDay(it.name + (it.meal ? ' · ' + it.meal : '') + (it.kcal ? ' · ' + it.kcal + ' kcal' : ''), it),
      };
    case 'note':
      return { icon: 'notebook-pen', label: 'Note', detail: it.text };
    case 'focus':
      return { icon: 'timer', label: 'Start focus', detail: (it.minutes || 'Usual') + (it.minutes ? ' min' : ' length') };
    case 'open':
      return { icon: 'chevron-right', label: 'Open', detail: SCREEN_LABEL[it.screen] || it.screen };
    case 'setting':
      return it.key === 'theme'
        ? { icon: 'moon', label: 'Theme', detail: it.value === 'system' ? 'Follow the phone' : it.value === 'dark' ? 'Dark' : 'Light' }
        : { icon: 'droplets', label: 'Water goal', detail: it.value + ' ml a day' };
    default:
      return null;
  }
}

/* A row's detail plus its day, when the sentence named one that isn't today. */
function withDay(detail, it) {
  const w = dayWord(intentDay(it, todayKey()), todayKey());
  return w ? detail + ' · ' + w : detail;
}

/** A due instant in words: "Tomorrow, 5:00 PM", "Fri 16 Oct, 6:00 PM". */
function dueLabel(d) {
  return shortDay(keyOfDate(d)) + ', ' + formatTime(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
}

/** "09:00:00" (the API's LocalTime) -> "09:00"; anything else -> "". */
function hhmm(v) {
  const m = /^(\d{2}):(\d{2})/.exec(String(v || ''));
  return m ? m[1] + ':' + m[2] : '';
}

/* What a spoken reminder will be, in full, so the preview shows every field
   before anything is saved: "Call mom · Tomorrow, 7:00 PM to 7:30 PM · Weekly
   until 31 Dec · 10 min before · Work". */
function reminderSummary(it) {
  const bits = [it.text];
  const day = it.date || todayKey();
  const when = day === todayKey() ? 'Today' : shortDay(day);
  bits.push(
    when +
      (it.time ? ', ' + formatTime(hhmm(it.time)) : '') +
      (it.endTime ? ' to ' + formatTime(hhmm(it.endTime)) : '')
  );
  if (it.repeat && it.repeat !== 'none' && REPEATS[it.repeat]) {
    bits.push(
      REPEATS[it.repeat].label +
        (it.until ? ' until ' + new Date(it.until + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')
    );
  }
  if (it.time && it.notifyBefore) bits.push(leadLabel(it.notifyBefore));
  if (it.tag && it.tag !== 'personal' && TAGS[it.tag]) bits.push(TAGS[it.tag].label);
  return bits.join(' \u00b7 ');
}

/* ---- Voice input, everywhere text can be spoken ----
   Speech-to-text works on one language at a time: the one picked in Quick add
   (remembered), else the device's own. Browsers have the Web Speech API; the
   Capacitor app's WebView doesn't, so there the native SpeechRecognition plugin
   takes over. One helper, so Quick add, the calendar's reminder form and
   Settings → Reminders all listen the same way. */
const VOICE_LANGS = [
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
/* The picked language (ui_prefs.qaLang, the account's), else the device's own
   matched against VOICE_LANGS: Quick add's picker and every other mic read this
   one answer, so they can't default differently. */
function speechLang() {
  const saved = ((state.user && state.user.uiPrefs) || {}).qaLang;
  if (saved) return saved;
  const device = navigator.language || 'en-IN';
  const base = (c) => c.split('-')[0];
  const match =
    VOICE_LANGS.find((l) => l.code === device) ||
    VOICE_LANGS.find((l) => base(l.code) === base(device));
  return match ? match.code : device;
}

function voiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition || nativePlugin('SpeechRecognition'));
}

/* Listen once; resolves to what was said ('' for nothing heard). A second tap on
   `btn` while listening stops it early, which still hands back what was heard.
   `btn` carries .is-listening throughout. Says why when it can't listen. */
const listening = new WeakMap(); // btn -> stop()
function listenOnce(btn, lang) {
  if (listening.has(btn)) {
    listening.get(btn)();
    return Promise.resolve(null);
  }
  const code = lang || speechLang();
  const capSR = nativePlugin('SpeechRecognition');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!capSR && !SR) {
    pushToast('Voice input isn’t available in this browser.', 'error', 3200);
    return Promise.resolve('');
  }
  btn.classList.add('is-listening');
  btn.setAttribute('aria-pressed', 'true');
  const finish = (said) => {
    listening.delete(btn);
    btn.classList.remove('is-listening');
    btn.setAttribute('aria-pressed', 'false');
    return said;
  };
  if (capSR) {
    listening.set(btn, () => capSR.stop().catch(() => {}));
    return (async () => {
      try {
        const perm = await capSR.requestPermissions();
        if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') {
          pushToast('Microphone access was blocked — allow it in Settings.', 'error', 3600);
          return finish('');
        }
        const res = await capSR.start({ language: code, maxResults: 1, partialResults: false, popup: false });
        const said = res && res.matches && res.matches[0] ? res.matches[0].trim() : '';
        if (!said) pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
        return finish(said);
      } catch (_) {
        pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
        return finish('');
      }
    })();
  }
  return new Promise((resolve) => {
    const rec = new SR();
    rec.lang = code;
    rec.interimResults = false;
    let said = '';
    let failed = false;
    listening.set(btn, () => rec.stop());
    rec.onresult = (e) => {
      said = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
    };
    rec.onerror = (e) => {
      failed = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        pushToast('Microphone access was blocked — allow it in your browser.', 'error', 3600);
      } else if (e.error !== 'aborted') {
        pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
      }
    };
    rec.onend = () => {
      if (!said && !failed) pushToast('Didn’t catch that — try speaking again.', 'error', 3000);
      resolve(finish(said));
    };
    try {
      rec.start();
    } catch (_) {
      resolve(finish(''));
    }
  });
}

/* Speak a whole reminder into a form: "every Monday at 7 to 7:30 call mom, ten
   minutes before". Listens, then reads the sentence with Quick add's parser and
   hands back {said, reminder} — reminder null when it couldn't be read (no AI
   key, assistant down, or nothing reminder-like), and the caller falls back to
   the words alone. Nothing is saved: the form shows it all for a check first. */
async function captureReminder(btn) {
  const said = await listenOnce(btn);
  if (!said) return null;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    const r = await parseQuickAdd(said);
    const reminder = (r.intents || []).find((x) => x.type === 'reminder') || null;
    if (reminder) {
      // Read, by the model or the plain patterns: the form shows every field for a check.
    } else if (!r.configured) {
      pushToast('Heard you. Couldn’t read a time and day from that, so set those yourself.', 'info', 4200);
    } else if (r.unavailable) {
      pushToast('Heard you, but couldn’t reach the assistant — set the time and day yourself.', 'info', 4200);
    }
    return { said, reminder };
  } catch (err) {
    toastError(err, 'Couldn’t read that — set the time and day yourself.');
    return { said, reminder: null };
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
}

/* Every intent through the handler its own screen uses. Controls (open a
   screen, start the timer, switch the theme) run last, so the logging lands
   first and the screen the sentence asked for is where the user ends up. */
async function applyQuickAdd(intents) {
  const applied = []; // [{ it, ref }]; ref = applyIntent's answer: an undo, or true
  const ordered = intents
    .filter((it) => !CONTROL_INTENTS.has(it.type))
    .concat(intents.filter((it) => CONTROL_INTENTS.has(it.type)));
  quietSuccess++;
  try {
    for (const it of ordered) {
      try {
        const ref = await applyIntent(it);
        if (ref) applied.push({ it, ref });
      } catch (_) {
        /* skip a single bad intent; keep applying the rest */
      }
    }
  } finally {
    quietSuccess--;
  }
  return applied;
}

/* The undo for everything applied, or null when a part can't be taken back
   (a control; a sleep or mood that was the day's first, with no delete for
   those). Runs newest first, quietly, then says it once. */
function undoAll(applied) {
  const undos = applied.filter((a) => !CONTROL_INTENTS.has(a.it.type)).map((a) => a.ref);
  if (!undos.length || undos.some((u) => typeof u !== 'function')) return null;
  return async () => {
    quietSuccess++;
    try {
      for (const u of undos.reverse()) await Promise.resolve(u()).catch(() => {});
    } finally {
      quietSuccess--;
    }
    render();
    pushToast('Undone.', 'success', 3000);
  };
}

/* One toast for what landed: where it went (or, for one thing, what it was)
   and Undo when every part can be taken back; a lone first sleep or mood of the
   day offers Edit instead. */
function announceQuickAdd(applied, line) {
  const undo = undoAll(applied);
  const one = applied.length === 1 ? applied[0].it : null;
  const text = line || loggedToLine(applied);
  if (undo) pushToast(text, 'success', 6000, { label: 'Undo', run: undo });
  else if (one && (one.type === 'sleep' || one.type === 'mood'))
    pushToast(text, 'success', 6000, { label: 'Edit', run: one.type === 'sleep' ? openSleepSchedule : openMoodCheckin });
  else toastSuccess(text);
}

/* The id a write added to a day's list: the answer for a water glass or a food
   entry carries the whole day, not the new row. */
function addedId(entries, before) {
  const e = (entries || []).find((x) => x && !before.has(x.id) && !String(x.id).startsWith('pending-'));
  return e ? e.id : null;
}

/* Where each logged intent went, for the toast: "Logged to Money and Food." */
const INTENT_PLACE = {
  task: 'Tasks',
  task_done: 'Tasks',
  habit: 'Habits',
  habit_new: 'Habits',
  water: 'Water',
  food: 'Food',
  sleep: 'Sleep',
  mood: 'Mood',
  expense: 'Money',
  income: 'Money',
  note: 'Notes',
  reminder: 'Calendar',
  goal: 'Goals',
};
function loggedToLine(applied) {
  const places = [...new Set(applied.map((a) => INTENT_PLACE[a.it.type]).filter(Boolean))];
  if (!places.length) return 'Done.';
  const list = places.length > 1 ? places.slice(0, -1).join(', ') + ' and ' + places[places.length - 1] : places[0];
  return 'Logged to ' + list + '.';
}

/* One intent. False when nothing was written; else how to take it back (an
   async function), or true when it can't be (a control, a first sleep or mood
   of the day, an offline glass still queued). */
async function applyIntent(it) {
  switch (it.type) {
    case 'task': {
      if (!it.title) return false;
      const t = await createTask({ title: it.title, ...(it.dueAt ? { dueAt: it.dueAt } : {}) });
      return t ? () => deleteTask(t.id) : true;
    }
    case 'task_done': {
      const t = matchOpenTask(it.title);
      if (!t) return false;
      await toggleTask(t.id);
      return () => toggleTask(t.id);
    }
    case 'habit': {
      const hb = (state.habits || []).find((x) => (x.name || '').toLowerCase() === String(it.name || '').toLowerCase());
      if (!hb) return false;
      if (hb.doneToday) return () => {}; // already ticked: nothing to take back
      await toggleHabit(hb.id);
      return () => toggleHabit(hb.id);
    }
    case 'habit_new': {
      if (!it.name) return false;
      if ((state.habits || []).some((x) => (x.name || '').toLowerCase() === it.name.toLowerCase())) return false;
      const made = await createHabit({ name: it.name, domain: 'habit', icon: 'repeat', cadence: 'daily', metric: 'none' });
      return made && made.id ? () => deleteHabit(made.id) : true;
    }
    case 'goal': {
      if (!it.title) return false;
      const g = await createGoal({ title: it.title, horizon: 'short_term' });
      // At once, not through deleteGoal's own Undo toast: this is the Undo.
      return g && g.id
        ? () => {
            state.goals = (state.goals || []).map((sec) => ({ ...sec, goals: (sec.goals || []).filter((x) => x.id !== g.id) }));
            return sendGoalDelete(g.id);
          }
        : true;
    }
    case 'water': {
      if (!it.amountMl) return false;
      const before = new Set(((state.water && state.water.entries) || []).map((e) => e.id));
      await quickAddWater(it.amountMl);
      const id = addedId(state.water && state.water.entries, before);
      if (!id) return true;
      return async () => {
        state.water = withPendingWater(await api('/api/water/entries/' + id, { method: 'DELETE' }));
        invalidateWeek('water');
      };
    }
    case 'food': {
      if (!it.name) return false;
      // A named past day ("yesterday") lands at that day's noon.
      const day = intentDay(it, todayKey());
      const before = new Set(((state.food && state.food.entries) || []).map((e) => e.id));
      await logFoodEntry({
        foodName: it.name,
        mealSlot: it.meal || null,
        kcal: it.kcal || null,
        loggedAt: (day === todayKey() ? new Date() : new Date(day + 'T12:00:00')).toISOString(),
      });
      const id = day === todayKey() && addedId(state.food && state.food.entries, before);
      if (!id) return true;
      return async () => {
        const updated = await api('/api/food/entries/' + id, { method: 'DELETE' });
        state.food = updated;
        cacheFoodSummary(updated);
        invalidateWeek('food');
      };
    }
    case 'sleep': {
      if (!it.hours) return false;
      const p = quickSleepPayload(it);
      const was = (state.wellness.sleepByDate || {})[p.date];
      await saveSleepEntry(p);
      return was ? () => saveSleepEntry({ ...was, date: p.date }) : true;
    }
    case 'mood': {
      if (!it.mood) return false;
      const was = (state.wellness.moodByDate || {})[todayKey()];
      // Energy only when the sentence said it.
      await saveMoodEntry({ mood: it.mood, energy: it.energy || null });
      return was ? () => saveMoodEntry({ ...was, date: todayKey() }) : true;
    }
    case 'expense': {
      if (!it.amount) return false;
      const id = addQuickExpense(it);
      return () => removeQuickMoney(new Set([id]));
    }
    case 'income': {
      if (!it.amount) return false;
      const id = addQuickIncome(it);
      return () => removeQuickMoney(new Set([id]));
    }
    case 'note': {
      if (!it.text) return false;
      const n = await api('/api/notes', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdemKey() },
        body: JSON.stringify({ body: '<p>' + escapeHtml(it.text) + '</p>' }),
      });
      if (!n || !n.id) return true;
      // Gone for good: a note taken back a second later is not one to keep in the Trash.
      return async () => {
        await api('/api/notes/' + encodeURIComponent(n.id), { method: 'DELETE' });
        await api('/api/notes/' + encodeURIComponent(n.id) + '/forever', { method: 'DELETE' });
      };
    }
    case 'reminder': {
      if (!it.text) return false;
      // Every field the sentence gave, through the same path as the calendar's
      // own form — so the past-day refusal applies here too (an hour already
      // gone today was moved to tomorrow by settleIntent).
      const made = await addReminder(
        it.date || todayKey(),
        it.text,
        hhmm(it.time),
        it.tag || 'personal',
        it.repeat || 'none',
        it.until || '',
        '',
        hhmm(it.endTime),
        it.notifyBefore === null || it.notifyBefore === undefined ? null : it.notifyBefore
      );
      return made ? () => deleteReminder('all', made.id) : false;
    }
    case 'focus':
      focusAutoStart = it.minutes || true;
      if (state.screen === 'focus') render();
      else setScreen('focus');
      return true;
    case 'open':
      if (it.screen === 'settings') openProfileSettings();
      else if (SCREENS[it.screen] && screenEnabled(it.screen)) setScreen(it.screen);
      else return false;
      return true;
    case 'setting':
      if (it.key === 'theme') return setThemeChoice(it.value);
      if (it.key === 'waterGoal' && Number(it.value) >= 500) {
        await updateWaterGoal(Number(it.value));
        return true;
      }
      return false;
    default:
      return false;
  }
}

/* "dark mode" / "light mode" / "follow the phone": the same writes the theme
   button makes, plus clearing the pick so the system setting decides again. */
function setThemeChoice(value) {
  if (value === 'system') {
    try {
      CacheStorage.removeItem(THEME_KEY);
    } catch (_) {}
    saveUiPrefs({ theme: null });
    state.theme = systemDark && systemDark.matches ? 'dark' : 'light';
    applyTheme(state.theme);
    render();
    return true;
  }
  if (value !== 'dark' && value !== 'light') return false;
  // Saved even when it already looks that way: Dark picked while the phone
  // is dark has to stop following the phone.
  if (state.theme !== value) toggleTheme();
  else {
    try {
      CacheStorage.setItem(THEME_KEY, value);
    } catch (_) {}
    saveUiPrefs({ theme: value });
  }
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function loadGoals() {
  try {
    state.goals = await api('/api/goals');
    state.goalsFailed = false;
  } catch (err) {
    state.goalsFailed = true;
    toastError(err, 'Could not load goals.');
  }
  render();
}

async function createGoal(body) {
  const created = await api('/api/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // The POST answers with the goal, so place it (newest first, as /api/goals
  // sorts) instead of holding the dialog open for a full reload.
  const sec = (state.goals || []).find((x) => x.horizon === created.horizon);
  // goals.js opens gb-kit's modal, which has no render() after it closes.
  if (sec) {
    sec.goals = [created, ...(sec.goals || [])];
    render();
  } else loadGoals();
  // The next step is known: the goal's first task, linked already (taskForm's presetGoalId).
  pushToast('Goal saved.', 'success', 6000, { label: 'Add first task', run: () => openAddTask(created) });
  return created;
}

/* Called straight from Goals' "Mark done" button, with nobody awaiting it: a
   failure was an unhandled rejection with no word to the user, and a second tap
   before the reload landed toggled the goal straight back. */
const goalTogglesInFlight = new Set();

/* ---- Goals linked to habits ----
   A goal's progress blob may carry `linkedHabitIds` (and `autoDays`: the day
   tracker counts the days any linked habit was done, from `autoSince`). The
   Goals screen needs those habits' done days, so each linked habit's history
   is fetched once per day and span, kept here, and today's own tick is read
   off `state.habits` live, so ticking a habit on Home moves the goal at once
   without a refetch. A past day ticked from a habit's history drops its entry
   (`forgetGoalHabitHistory`). */
const goalHabitHistory = {}; // habitId -> { key, days }
const goalHabitInFlight = new Set();

function goalHabitNeeds() {
  const today = accountTodayKey();
  const span = {}; // habitId -> days back needed
  Object.values(state.goalProgress || {}).forEach((p) => {
    if (!p || !Array.isArray(p.linkedHabitIds)) return;
    let back = daysFrom(monthStart(today), today) + 1;
    if (p.autoDays && p.autoSince) back = Math.max(back, daysFrom(p.autoSince, today) + 1);
    back = Math.min(730, Math.max(1, back));
    p.linkedHabitIds.forEach((id) => {
      span[id] = Math.max(span[id] || 0, back);
    });
  });
  return { today, span };
}

function ensureGoalHabitHistory() {
  const { today, span } = goalHabitNeeds();
  const live = new Set((state.habits || []).map((x) => x.id));
  Object.keys(span).forEach((id) => {
    if (!live.has(id)) return;
    const key = today + '|' + span[id];
    const have = goalHabitHistory[id];
    if ((have && have.key === key) || goalHabitInFlight.has(id)) return;
    goalHabitInFlight.add(id);
    api('/api/habits/' + encodeURIComponent(id) + '/history?days=' + span[id])
      .then((res) => {
        goalHabitHistory[id] = { key, days: (res && res.days) || [] };
        if (state.screen === 'goals' || state.screen === 'home') render();
      })
      .catch(() => {
        // Counted as nothing done rather than retried every render.
        goalHabitHistory[id] = { key, days: [] };
      })
      .finally(() => goalHabitInFlight.delete(id));
  });
}

/* goalProgress with each counted-from-habits tracker's `daysFollowed` set to
   what its linked habits add up to — what Goals and Home's GoalsCard draw. The
   stored count is left alone; it is what the tracker falls back to if the
   links are removed. */
function effectiveGoalProgress() {
  const gp = state.goalProgress || {};
  const sum = goalHabitSummary();
  let out = gp;
  Object.keys(sum).forEach((id) => {
    const p = gp[id];
    if (sum[id].autoDays == null || !p || !p.durationDays) return;
    if (out === gp) out = { ...gp };
    out[id] = { ...p, daysFollowed: Math.min(p.durationDays, sum[id].autoDays) };
  });
  // Linked tasks (tasks.goal_id): `linkedTasks` {done, total, open} for the
  // card, and `work` — milestones plus, when `countTasks` is on, the finished
  // tasks (goal-tasks.js combinedGoalProgress). Both derived, never saved:
  // every progress write is a patch of its own fields.
  (state.goals || [])
    .flatMap((sec) => sec.goals || [])
    .forEach((g) => {
      const key = String(g.id);
      const linkedTasks = goalTaskStats(g, state.tasks);
      if (!linkedTasks.total && !(out[key] && out[key].countTasks)) return;
      if (out === gp) out = { ...gp };
      const p = out[key] || {};
      out[key] = { ...p, linkedTasks, work: combinedGoalProgress(p, linkedTasks) };
    });
  return out;
}

function forgetGoalHabitHistory(habitId) {
  delete goalHabitHistory[habitId];
}

/* Per habit id, its done days: the fetched past plus today from the live habit. */
function linkedHabitDays() {
  const today = accountTodayKey();
  const out = {};
  (state.habits || []).forEach((hb) => {
    const past = ((goalHabitHistory[hb.id] && goalHabitHistory[hb.id].days) || []).filter(
      (r) => r.date !== today
    );
    out[hb.id] = hb.doneToday ? past.concat({ date: today, done: true }) : past;
  });
  return out;
}

/* What GoalRow prints for linked habits: check-ins this month, and — for a
   tracker counting from habits — the distinct done days since `autoSince`.
   Starts any history it is still missing; that lands with its own render. */
function goalHabitSummary() {
  ensureGoalHabitHistory();
  const today = accountTodayKey();
  const days = linkedHabitDays();
  const out = {};
  Object.entries(state.goalProgress || {}).forEach(([goalId, p]) => {
    const ids = (p && Array.isArray(p.linkedHabitIds) ? p.linkedHabitIds : []).filter(
      (id) => days[id]
    );
    if (!ids.length) return;
    out[goalId] = {
      count: ids.length,
      month: linkedHabitActivity(days, ids, monthStart(today), today).checkins,
      autoDays:
        p.autoDays && p.autoSince
          ? linkedHabitActivity(days, ids, p.autoSince, today).days
          : null,
    };
  });
  return out;
}

/* Swap one goal inside the horizon sections. */
function mapGoal(id, fn) {
  state.goals = (state.goals || []).map((sec) => ({
    ...sec,
    goals: (sec.goals || []).map((g) => (g.id === id ? fn(g) : g)),
  }));
}

/* Paint first: it used to wait on the toggle and then a full /api/goals reload.
   The toggle answers with the whole goal, so that is all the reconcile needs. */
async function toggleGoal(id) {
  if (goalTogglesInFlight.has(id)) return;
  goalTogglesInFlight.add(id);
  mapGoal(id, (g) => ({ ...g, completed: !g.completed }));
  render();
  try {
    const updated = await api('/api/goals/' + encodeURIComponent(id) + '/toggle', {
      method: 'PATCH',
    });
    if (updated && updated.id) mapGoal(id, () => updated);
    render();
    // Finishing a goal is the biggest thing the app tracks; it went by as a
    // chip changing colour. Reopening is not celebrated.
    if (updated && updated.completed) {
      celebrate({
        icon: 'trophy',
        kicker: 'Goal complete',
        title: updated.title,
        desc: 'You did it.',
      });
    }
  } catch (err) {
    mapGoal(id, (g) => ({ ...g, completed: !g.completed }));
    render();
    toastError(err, 'Could not update that goal.');
  } finally {
    goalTogglesInFlight.delete(id);
  }
}

/* PUT /api/goals/{id}: title, why, horizon, target date. A changed horizon
   moves the goal to its new section. */
async function updateGoal(id, body) {
  const updated = await api('/api/goals/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  state.goals = (state.goals || []).map((sec) => ({
    ...sec,
    goals:
      sec.horizon === updated.horizon
        ? (sec.goals || []).some((g) => g.id === id)
          ? sec.goals.map((g) => (g.id === id ? updated : g))
          : [updated, ...(sec.goals || [])]
        : (sec.goals || []).filter((g) => g.id !== id),
  }));
  // goals.js opens its dialogs on gb-kit's openModal, which has no render hook.
  render();
  toastSuccess('Goal updated.');
}

/* Every action of one goal: the list carries only the latest three. */
function loadGoalActions(id) {
  return api('/api/goals/' + encodeURIComponent(id) + '/actions');
}

/* The DELETE is the whole answer: drop the goal where it sits rather than
   reload every goal, and take its cached progress with it (that blob used to
   stay in CacheStorage for good). */
function deleteGoal(id) {
  let item = null;
  let secAt = -1;
  let at = 0;
  deferDelete({
    message: 'Goal deleted.',
    errorText: 'Could not delete that goal.',
    remove: () => {
      (state.goals || []).forEach((sec, si) => {
        const i = (sec.goals || []).findIndex((g) => g.id === id);
        if (i < 0) return;
        item = sec.goals[i];
        secAt = si;
        at = i;
      });
      if (secAt < 0) return;
      state.goals = (state.goals || []).map((sec) => ({
        ...sec,
        goals: (sec.goals || []).filter((g) => g.id !== id),
      }));
    },
    // Back into the section it left, at its place (a reload may have reshaped them).
    restore: () => {
      const sec = (state.goals || [])[secAt];
      if (!item || !sec || (state.goals || []).some((s) => (s.goals || []).some((g) => g.id === id))) return;
      const goals = sec.goals || [];
      state.goals = state.goals.map((s, si) =>
        si === secAt ? { ...s, goals: [...goals.slice(0, at), item, ...goals.slice(at)] } : s
      );
    },
    commit: () => sendGoalDelete(id),
  });
}

async function sendGoalDelete(id) {
  await api('/api/goals/' + encodeURIComponent(id), { method: 'DELETE', keepalive: true });
  if (!state.user) return;
  // The server took its tasks off it (they stay, on no goal); mirror that.
  state.tasks = (state.tasks || []).map((t) => (t.goalId === id ? { ...t, goalId: null } : t));
  if (state.goalProgress && state.goalProgress[String(id)]) {
    delete state.goalProgress[String(id)];
    persistGoalProgress();
  }
  render();
}

async function addGoalAction(id, body) {
  await api('/api/goals/' + encodeURIComponent(id) + '/actions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // An action doesn't move the percentage, but it is a day the goal was
  // worked on: date it in the progress log (goalPace) unless today is there.
  const gp = state.goalProgress && state.goalProgress[String(id)];
  if (gp && needsProgressLog(gp, accountTodayKey())) updateGoalProgress(id, {});
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

/* Its history goes with it, which the toast can't say in two words: Undo is
   the whole of the safety. */
function deleteHabit(id) {
  deferDelete({
    message: 'Habit deleted.',
    errorText: 'Could not delete that habit.',
    ...listSlot(() => state.habits, (l) => (state.habits = l), id),
    commit: () => sendHabitDelete(id),
  });
}

async function sendHabitDelete(id) {
  await api('/api/habits/' + encodeURIComponent(id), { method: 'DELETE', keepalive: true });
  if (!state.user) return;
  refreshScoreLater();
  reSyncDeviceAlarms();
}

/* Undo of something just made (a Buddy chip): it goes now, with no second Undo
   toast for undoing the Undo. A failed send puts it back and says so. */
function unmake(get, set, id, send) {
  const slot = listSlot(get, set, id);
  slot.remove();
  render();
  send().catch((err) => {
    slot.restore();
    render();
    toastError(err, 'Could not undo that.');
  });
}

/* Paint the glass at once, then POST. Each accepted tap is its own entry (two
   deliberate +250s are 500 ml), but the same button again inside WATER_DOUBLE_TAP_MS
   is a finger bounce, not a second glass: that used to log twice. Taps still in
   flight are laid back over each server answer so one landing doesn't wipe the other. */
const WATER_DOUBLE_TAP_MS = 600;
const pendingWater = new Map(); // temp id -> { amountMl, loggedAt }
let lastWaterTap = { amount: 0, at: 0 };
let waterSeq = 0;
/* Out-of-order answers: two quick taps A then B, B's summary lands first and
   is painted, then A's arrives — painting it would drop the card back to A's
   view of the day (B has already left pendingWater, so the overlay can't put
   it back). Only the newest tap's answer paints; a skipped older one sets
   waterRefetch, and when the last tap in flight settles, one GET repaints. */
let waterPaintedSeq = 0;
let waterInFlight = 0;
let waterRefetch = false;

/* Glasses tapped with no connection: kept on this phone (CacheStorage, per
   account) and replayed with their own loggedAt, so a glass drunk at 23:50
   offline still counts for that day. It used to vanish with a "Could not log"
   toast. Each tap mints an Idempotency-Key that its live POST and every replay
   send, so a POST that landed but whose answer was lost is answered again by
   the server, not logged as a second glass. */
function waterQueueKey() {
  return moneyStorageKey(state.user) + '.water';
}
function loadWaterQueue() {
  try {
    const q = JSON.parse(CacheStorage.getItem(waterQueueKey()) || '[]');
    return Array.isArray(q) ? q.filter((x) => x && x.id && x.amountMl > 0 && x.loggedAt) : [];
  } catch (_) {
    return [];
  }
}
function storeWaterQueue(q) {
  try {
    CacheStorage.setItem(waterQueueKey(), JSON.stringify(q));
  } catch (err) {
    console.error('Failed to keep an unsent glass of water:', err);
  }
}
/* A boot after an offline session: put its queued glasses back on the card. */
function restoreWaterQueue() {
  for (const x of loadWaterQueue())
    if (!pendingWater.has(x.id))
      pendingWater.set(x.id, { amountMl: x.amountMl, loggedAt: x.loggedAt, drinkType: x.drinkType });
}
/* The account's day of a glass, like water.date and todayKey(): the device's
   day hid a queued glass when the two zones differ, and a second tap logged it twice. */
const localDayOf = (iso) => sharedTodayKey(state.user && state.user.timezone, new Date(iso));

/* Taps not yet on the server, laid over a summary from it. Only the summary's
   own day: a glass queued last night is yesterday's, not today's. */
function withPendingWater(water) {
  return overlayPendingWater(water, pendingWater, { today: todayKey(), dayOf: localDayOf, effectiveMl });
}

/* No connection, or a server that's down: worth queueing. A 4xx is a refusal,
   and an ended session is nobody's (app-logic.js). */
const offlineError = (err) => isOfflineError(err, navigator.onLine);

/* ---- Offline outbox (scripts/outbox.js) ----
   Task create / toggle / delete, a plain habit tick, a one-off reminder's
   create, a whole-series reminder delete and a text-only note create keep their
   optimistic paint when there is no connection: the write is queued here
   (CacheStorage, gb.outbox.<uid>, purged on logout) and replayed oldest first
   by flushOutbox() after loadData's wave 1 and on 'online'. Creates wear a
   `tmp-…` id until the POST lands; `outboxIds` maps it to the server's id for
   anything still holding the temp one (a note card, a row mid-refresh). */
function outboxKey() {
  const u = state.user || loadSession() || {};
  return 'gb.outbox.' + String(u.id || u.email || 'guest');
}
const outbox = createOutbox(CacheStorage, outboxKey);
const outboxIds = new Map();
const realId = (id) => outboxIds.get(id) || id;
/* The id to put in a path for an edit, pause, done or snooze. A row made offline
   whose create hasn't landed has none yet: a `tmp-` id in the path is a 400. */
const STILL_SYNCING = 'That was made offline and is still syncing. Try again in a moment.';
function liveId(id) {
  const r = realId(id);
  if (isTempId(r)) throw Object.assign(new Error(STILL_SYNCING), { status: 0, local: true });
  return r;
}
/* No response at all. A 5xx is the server answering; those roll back and toast. */
const networkError = (err) => isNetworkError(err, navigator.onLine);

/* Async: the outbox lives in the Cache API, and until CacheStorage has hydrated
   it reads as empty: an enqueue then would overwrite the persisted queue. */
async function queueWrite(op) {
  await CacheStorage.ready();
  const r = outbox.enqueue(op);
  if (r !== 'cancelled') pushToast(SAVED_ON_PHONE, 'info');
  paintOutboxChip();
  // A temp id touched while online (its create is still queued): send now.
  if (state.online && navigator.onLine) flushOutbox();
  else armOutboxRetry();
  return r;
}

/* Write-ahead, Money's pattern (saveMoney queues before it sends). `op` is in
   the outbox, marked live, before `send()` goes out: a page that unloads
   mid-request (reload, tab closed, the phone killing the app) replays it at
   the next boot, where the old way lost a write the UI had already shown as
   done. It carries the live request's idemKey, so replaying one that landed is
   answered from the server's cache. Answered: dropped. No response: queued
   for real (queueWrite, which says so) and rethrown with `err.queued`, so the
   caller keeps its optimistic paint. */
async function sendAhead(op, send) {
  await CacheStorage.ready();
  const id = 'op-' + (op.idemKey || newIdemKey());
  outbox.enqueue({ ...op, id, live: true });
  try {
    const res = await send();
    outbox.remove(id);
    return res;
  } catch (err) {
    outbox.remove(id);
    if (networkError(err)) {
      await queueWrite(op);
      err.queued = true;
    }
    throw err;
  }
}

/* Queued writes used to go only after wave 1 and on 'online'. Wi-Fi with no
   internet, a captive portal or a server waking up never fires 'online' (the
   browser thought it was online all along), so they sat until the next launch.
   Also on a timer while anything waits: 30 s, doubling to 5 min, back to 30 s
   once the queue empties. visibilitychange flushes too. */
const OUTBOX_RETRY_MIN = 30_000;
const OUTBOX_RETRY_MAX = 5 * 60_000;
let outboxRetryMs = OUTBOX_RETRY_MIN;
let outboxRetryTimer = 0;
function armOutboxRetry() {
  clearTimeout(outboxRetryTimer);
  outboxRetryTimer = 0;
  if (!state.user || (!outbox.size() && !loadWaterQueue().some((x) => !x.live))) {
    outboxRetryMs = OUTBOX_RETRY_MIN;
    return;
  }
  outboxRetryTimer = setTimeout(() => {
    outboxRetryMs = Math.min(outboxRetryMs * 2, OUTBOX_RETRY_MAX);
    flushQueued();
  }, outboxRetryMs);
}
function flushQueued() {
  // flushWaterQueue ends in a render(): only when there is a glass to send.
  if (loadWaterQueue().some((x) => !x.live)) flushWaterQueue();
  flushOutbox();
}

/* Lay what's queued over lists just read from the server, which has not seen
   it yet. Called right after state.tasks / habits / reminders are replaced. */
function overlayOutbox() {
  const today = todayKey();
  // Not a live op: its own request is out, and its answer paints the real row.
  for (const op of outbox.list().filter((x) => !x.live)) {
    const l = op.local || {};
    if (op.kind === 'task.create' && !state.tasks.some((t) => t.id === l.id)) state.tasks = [l, ...state.tasks];
    else if (op.kind === 'task.update')
      state.tasks = state.tasks.map((t) => (t.id === l.id ? mapTask({ ...t, ...l }) : t));
    else if (op.kind === 'task.toggle')
      state.tasks = state.tasks.map((t) => (t.id === l.id ? { ...t, done: !t.done } : t));
    else if (op.kind === 'task.delete') state.tasks = state.tasks.filter((t) => t.id !== l.id);
    else if (op.kind === 'habit.checkin' && l.day === today)
      state.habits = state.habits.map((x) => (x.id === l.id ? { ...x, doneToday: !!l.done } : x));
    else if (op.kind === 'reminder.create' && !state.reminders.some((r) => r.id === l.id))
      state.reminders = [...state.reminders, l];
    else if (op.kind === 'reminder.delete') state.reminders = state.reminders.filter((r) => r.id !== l.id);
  }
  undoQueue.reapply(); // and what is waiting out an Undo toast
}
/* Notes the server hasn't got yet, for the Notes screen's list. */
const queuedNotes = () =>
  outbox
    .list()
    .filter((op) => op.kind === 'note.create' && op.local && !op.live)
    .map((op) => op.local);

async function flushOutbox() {
  await CacheStorage.ready();
  if (!state.user || !outbox.size()) {
    armOutboxRetry();
    return paintOutboxChip();
  }
  const out = await outbox.flush(api);
  Object.entries(out.idMap).forEach(([tmp, id]) => outboxIds.set(tmp, id));
  const done = [...out.sent, ...out.dropped, ...out.conflicts];
  if (out.dropped.length === 1) toastError(null, 'A change made offline couldn’t be saved: ' + out.dropped[0].message);
  else if (out.dropped.length) toastError(null, out.dropped.length + ' changes made offline couldn’t be saved.');
  // 409: someone (another device) changed it meanwhile. Say so; the refetch shows theirs.
  out.conflicts.forEach((c) => toastError(null, c.message || 'That was changed somewhere else, so your offline change was skipped.'));
  if (done.length) await refreshOutboxStores(new Set(done.map((x) => String(x.op.kind).split('.')[0])));
  paintOutboxChip();
  armOutboxRetry();
}

async function refreshOutboxStores(kinds) {
  const jobs = [];
  if (kinds.has('task')) jobs.push(api('/api/tasks').then((r) => (state.tasks = r.map(mapTask))));
  if (kinds.has('habit'))
    jobs.push(
      api('/api/habits').then((r) => {
        state.habits = r;
        reconcileStreakFreeze();
      })
    );
  if (kinds.has('reminder')) jobs.push(api('/api/reminders').then((r) => (state.reminders = r)));
  await Promise.allSettled(jobs);
  overlayOutbox();
  if (kinds.has('task') || kinds.has('habit')) await Promise.all([refreshScore(), refreshCurrentUser()]);
  if (kinds.has('habit') || kinds.has('reminder')) reSyncDeviceAlarms();
  // Notes own their list: a sent note keeps its card, and its temp id resolves
  // through outboxIds; the next load swaps in the server's copy. Screens that
  // own their subtree are left alone too (render() would drop their view state).
  const own = ['money', 'family', 'mentor', 'circle', 'notes'];
  if ((kinds.has('task') || kinds.has('habit') || kinds.has('reminder')) && !own.includes(state.screen)) render();
}

/* The "N changes waiting to sync" chip lives in the profile panel. */
function outboxChip() {
  const n = outbox.size();
  if (!n) return null;
  return h(
    'div',
    { class: 'gb-outbox-chip', role: 'status' },
    Icon('refresh-cw', { size: 14, sw: 2.4 }),
    n + (n === 1 ? ' change' : ' changes') + ' waiting to sync'
  );
}
function paintOutboxChip() {
  const slot = state.profileOpen && document.getElementById('gb-profile-slot');
  if (slot) slot.replaceChildren(...[profileDropdown()].filter(Boolean));
}

let waterFlushing = false;
/* Send the queued glasses, oldest first; stops at the first one that can't go. */
async function flushWaterQueue() {
  if (waterFlushing || !state.user) return;
  waterFlushing = true;
  let sentAny = false; // nothing queued: nothing changed, so no repaint (perf.e2e counts boot paints)
  try {
    await CacheStorage.ready();
    const send = (x) =>
      api('/api/water/entries', {
        method: 'POST',
        // Queued before taps carried a key: its temp id is stable, so that is one.
        headers: { 'Idempotency-Key': x.idemKey || 'water-' + x.id },
        body: JSON.stringify({ amountMl: x.amountMl, loggedAt: x.loggedAt, drinkType: x.drinkType || null }),
      });
    // Not a live glass: its own POST is still out (quickAddWater).
    const queued = loadWaterQueue().filter((x) => !x.live);
    sentAny = queued.length > 0;
    await replayOldestFirst(queued, send, {
      isOffline: offlineError,
      onSent: (x, updated) => {
        pendingWater.delete(x.id);
        storeWaterQueue(loadWaterQueue().filter((y) => y.id !== x.id));
        if (summaryIsForToday(updated, todayKey())) state.water = withPendingWater(updated);
        invalidateWeek('water');
      },
      onRefused: (x, err) => {
        // Refused (a day too far back, say): drop it rather than retry forever.
        pendingWater.delete(x.id);
        storeWaterQueue(loadWaterQueue().filter((y) => y.id !== x.id));
        const w = state.water || {};
        if ((w.entries || []).some((e) => e.id === x.id))
          state.water = {
            ...w,
            consumedMl: Math.max(0, (w.consumedMl || 0) - effectiveMl(x.amountMl, x.drinkType)),
            entries: w.entries.filter((e) => e.id !== x.id),
          };
        toastError(err, 'A glass of water from earlier could not be saved.');
      },
    });
  } finally {
    waterFlushing = false;
    if (sentAny) render();
    armOutboxRetry();
  }
}

/* `dayKey`: a past day from the custom dialog (backdating). Today, or none,
   is a tap: painted at once, then sent. `drinkType` (custom dialog only; the
   quick buttons are water): tea/coffee/... count for less, nutrition.js HYDRATION. */
async function quickAddWater(amountMl, dayKey, drinkType) {
  const drink = drinkType && drinkType !== 'water' ? drinkType : null;
  if (dayKey && dayKey !== todayKey()) {
    if (dayKey > todayKey()) {
      toastError(null, "You can't log water for a day that hasn't happened yet.");
      return;
    }
    try {
      await api('/api/water/entries', {
        method: 'POST',
        body: JSON.stringify({ amountMl, loggedAt: loggedAtFor(dayKey), drinkType: drink }),
      });
      invalidateWeek('water');
      render();
      toastSuccess(
        'Water logged for ' +
          new Date(dayKey + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
          '.'
      );
    } catch (err) {
      toastError(err, 'Could not log water right now.');
    }
    return;
  }
  const now = Date.now();
  if (lastWaterTap.amount === amountMl && now - lastWaterTap.at < WATER_DOUBLE_TAP_MS) {
    // Silently dropped, two quick +250s for 500 ml read as a lost glass.
    pushToast('Counted once. Tap again for another glass.', 'info', 1800);
    return;
  }
  lastWaterTap = { amount: amountMl, at: now };
  const seq = ++waterSeq;
  const tempId = 'pending-' + seq + '-' + now;
  const idemKey = newIdemKey(); // this glass, live or replayed
  const loggedAt = new Date(now).toISOString();
  pendingWater.set(tempId, { amountMl, loggedAt, drinkType: drink });
  const counts = effectiveMl(amountMl, drink);
  const w0 = state.water || {};
  state.water = {
    ...w0,
    consumedMl: (w0.consumedMl || 0) + counts,
    entries: [
      ...(w0.entries || []),
      { id: tempId, amountMl, loggedAt, drinkType: drink || 'water', effectiveMl: counts },
    ],
  };
  render();
  waterInFlight++;
  // Write-ahead (see sendAhead): on this phone, marked live, before the POST.
  // A page that unloads mid-request replays it at the next boot.
  await CacheStorage.ready();
  const glass = { id: tempId, amountMl, loggedAt, drinkType: drink, idemKey };
  storeWaterQueue(loadWaterQueue().concat({ ...glass, live: true }));
  const unqueue = () => storeWaterQueue(loadWaterQueue().filter((y) => y.id !== tempId));
  try {
    const updated = await api('/api/water/entries', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey },
      // No loggedAt on a live tap: the server's now, so a phone clock running
      // fast can't make it "the future". Only a queued replay sends its own.
      body: JSON.stringify({ amountMl: amountMl, drinkType: drink }),
    });
    unqueue();
    pendingWater.delete(tempId);
    const goal = (state.water && state.water.goalMl) || 0;
    // The glass that reaches the goal gets the popup; every other one a word of thanks.
    const goalMet = celebrateMoment(waterMoment(w0.consumedMl || 0, (w0.consumedMl || 0) + counts, goal, todayKey()));
    if (!goalMet && !drink) toastSuccess('Your body thanks you for the water.');
    if (seq > waterPaintedSeq) {
      waterPaintedSeq = seq;
      state.water = withPendingWater(updated);
      render();
    } else {
      waterRefetch = true;
    }
    invalidateWeek('water');
  } catch (err) {
    if (err && err.sessionEnded) return; // signed out meanwhile: state.water is the next account's
    unqueue();
    if (offlineError(err)) {
      // Keep the glass on the card and on this phone; 'online' or the retry sends it.
      await CacheStorage.ready();
      storeWaterQueue(loadWaterQueue().concat(glass));
      pushToast(savedLocallyMessage(err, navigator.onLine), 'info');
      armOutboxRetry();
      return;
    }
    pendingWater.delete(tempId);
    const w = state.water || {};
    state.water = {
      ...w,
      consumedMl: Math.max(0, (w.consumedMl || 0) - counts),
      entries: (w.entries || []).filter((e) => e.id !== tempId),
    };
    render();
    toastError(err, 'Could not log water right now.');
  } finally {
    if (--waterInFlight === 0 && waterRefetch) {
      waterRefetch = false;
      const fresh = await api('/api/water').catch(() => null);
      // A tap made while this GET was out has its own answer coming; let it paint.
      if (fresh && waterInFlight === 0 && summaryIsForToday(fresh, todayKey())) {
        state.water = withPendingWater(fresh);
        render();
      }
    }
  }
}

async function updateWaterGoal(goalMl) {
  try {
    const updated = await api('/api/water/goal', {
      method: 'PUT',
      body: JSON.stringify({ goalMl: goalMl }),
    });
    state.water = updated;
    // Same column as Settings -> Profile, so its field shows this goal too.
    // Not syncUserSession: that also re-applies UI prefs and refetches the chime.
    state.user = Object.assign({}, state.user, { dailyWaterGoalMl: updated.goalMl });
    saveSession(state.user, loadToken());
    render();
    invalidateWeek('water');
  } catch (err) {
    toastError(err, 'Could not update water goal right now.');
  }
}

/* Effects for a change made through a dialog. The dialog takes SHEET_EXIT_MS to go and
   re-renders the screen as it does, so playing at once would animate a row
   under the scrim that is about to be replaced. Wait it out, then play on the
   row that stays. */
const AFTER_DIALOG = SHEET_EXIT_MS + 20;
function landSoon(selector) {
  setTimeout(() => landed(root.querySelector(selector)), AFTER_DIALOG);
}
/* The row is still in `state` when the dialog closes, so it is still on
   screen; take it away visibly, then drop it from state. */
function removeSoon(selector, drop) {
  setTimeout(async () => {
    await leave(root.querySelector(selector));
    drop();
    render();
  }, AFTER_DIALOG);
}

/* Throws on failure. The Log food dialog stays open only when its onPrimary
   throws; catching here closed it over an entry that never saved.
   opts.undo: a one-tap log (a recent or favourite chip) toasts with Undo, which
   deletes the entry just made. Returns the new entry when it is today's. */
async function logFoodEntry(payload, opts) {
  const before = new Set(((state.food && state.food.entries) || []).map((e) => e.id));
  // Typed calories go to /manual, which makes no AI call and so sits outside
  // the AI rate limit: logging from a label used to spend a photo's budget.
  const updated = await api('/api/food/entries' + (payload.kcal != null ? '/manual' : ''), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  recentFoods = null; // the next Log food asks again
  // The summary that comes back belongs to the entry's own day. Backdate one
  // and that is not today — `state.food` drives the Home card, so only today's
  // may land there. The date-keyed cache below takes every day, which is what
  // the Calendar reads.
  const forToday = summaryIsForToday(updated, todayKey());
  if (forToday) state.food = updated;
  cacheFoodSummary(updated);
  render();
  const added = forToday && (updated.entries || []).find((e) => !before.has(e.id));
  if (added) landSoon('[data-food-id="' + added.id + '"]');
  invalidateWeek('food');
  if (opts && opts.undo && added) {
    pushToast('Logged ' + (added.foodName || 'food') + '.', 'success', 6000, {
      label: 'Undo',
      run: () => undoFoodLog(added.id),
    });
    return added;
  }
  toastSuccess(
    forToday
      ? 'Food logged.'
      : // 'T12:00' so the string parses as local noon — bare 'YYYY-MM-DD' is
        // UTC midnight, which renders as the day before west of Greenwich.
        'Food logged for ' +
          new Date(updated.date + 'T12:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }) +
          '.'
  );
}

/* Undo on a one-tap food log: DELETE the entry just made. The answer is that
   day's summary, so it lands like any other food write. */
async function undoFoodLog(id) {
  try {
    const updated = await api('/api/food/entries/' + encodeURIComponent(id), { method: 'DELETE' });
    if (summaryIsForToday(updated, todayKey())) state.food = updated;
    cacheFoodSummary(updated);
    recentFoods = null;
    invalidateWeek('food');
    render();
    toastSuccess('Removed.');
  } catch (err) {
    toastError(err, 'Could not undo that right now.');
  }
}

/* "Copy yesterday's breakfast" on an empty slot of the Food card: POST
   /api/food/entries/copy copies that slot's entries onto today as manual kcal
   (no AI). The answer is today's summary. */
async function copyYesterdaySlot(slot) {
  const label = (MEAL_SLOTS.find((m) => m.key === slot) || { label: slot }).label.toLowerCase();
  try {
    const before = new Set(((state.food && state.food.entries) || []).map((e) => e.id));
    const updated = await api('/api/food/entries/copy?slot=' + encodeURIComponent(slot), { method: 'POST' });
    state.food = updated;
    cacheFoodSummary(updated);
    recentFoods = null;
    invalidateWeek('food');
    render();
    const added = ((updated && updated.entries) || []).filter((e) => !before.has(e.id));
    added.forEach((e) => landed(root.querySelector('[data-food-id="' + e.id + '"]')));
    toastSuccess('Copied yesterday’s ' + label + '.');
  } catch (err) {
    toastError(err, 'Could not copy yesterday’s ' + label + ' right now.');
  }
}

/* The slots yesterday has entries in, for the Copy chips; null until known.
   Reuses the calendar's per-day cache, so a day already opened there costs
   nothing. A failed read leaves it null: no chips rather than chips that
   copy nothing. */
const yesterdayAsked = new Set();
function yesterdaySlots() {
  const y = yesterdayKey();
  const hit = state.calendarFoodByDate[y];
  if (hit) return new Set((hit.entries || []).map(slotOf));
  if (!yesterdayAsked.has(y)) {
    yesterdayAsked.add(y);
    api('/api/food?date=' + encodeURIComponent(y))
      .then((summary) => {
        cacheFoodSummary(summary);
        if (state.screen === 'food') render();
      })
      .catch(() => {});
  }
  return null;
}

/* Starred foods (GET /api/food/favourites), the first chip row in Log food.
   null = not asked yet; every star / unstar answers with the whole list. */
let favouriteFoods = null;
function loadFavouriteFoods() {
  if (favouriteFoods) return Promise.resolve(favouriteFoods);
  return api('/api/food/favourites')
    .then((list) => (favouriteFoods = Array.isArray(list) ? list : []))
    .catch(() => []);
}
async function starFoodEntry(entry, on) {
  const fav = (favouriteFoods || []).find(
    (f) => f.foodName.toLowerCase() === String(entry.foodName || '').trim().toLowerCase()
  );
  const list = on
    ? await api('/api/food/favourites', { method: 'POST', body: JSON.stringify({ entryId: entry.id }) })
    : fav
      ? await api('/api/food/favourites/' + encodeURIComponent(fav.id), { method: 'DELETE' })
      : favouriteFoods || [];
  favouriteFoods = Array.isArray(list) ? list : [];
  return favouriteFoods;
}

/* The browser's own barcode reader: BarcodeDetector + the rear camera. Chrome
   on Android has it, Safari and Firefox mostly don't, so the button is only
   built where both exist. The stream is stopped however the sheet goes
   (a read, Cancel, Escape, the backdrop): a camera left on keeps its light lit. */
const canScanBarcode = () =>
  typeof window !== 'undefined' &&
  'BarcodeDetector' in window &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function openBarcodeScanner(onCode) {
  let stream = null;
  let raf = 0;
  let done = false;
  const stop = () => {
    done = true;
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const { sheet, close } = openOverlay({ label: 'Scan barcode', className: 'gb-barcode-modal', onClose: stop });
  const video = h('video', { class: 'gb-barcode-video', playsinline: '', muted: '', autoplay: '' });
  video.muted = true;
  const status = h('div', { class: 'gb-field-hint', 'aria-live': 'polite' }, 'Point the camera at the barcode.');
  sheet.append(
    h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-modal-title' }, 'Scan barcode')),
    h('div', { class: 'gb-modal-body' }, h('div', { class: 'gb-barcode-frame' }, video), status),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel')
    )
  );
  let reasked = false; // one re-ask per scan: a WebView that keeps refusing a granted camera would loop
  const start = async () => {
    try {
      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
      });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      // Closed while the permission prompt was up: let the camera go at once.
      if (done) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (done) return;
        try {
          const codes = video.readyState >= 2 ? await detector.detect(video) : [];
          const code = codes && codes[0] && codes[0].rawValue;
          if (code && /^\d{6,14}$/.test(code)) {
            close(); // onClose stops the stream
            onCode(code);
            return;
          }
        } catch (_) {
          /* a frame it could not read; try the next */
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      stop();
      // getUserMedia above is the ask: the browser (or, in the app, Android
      // via Capacitor's onPermissionRequest) prompts when nothing is decided yet.
      status.textContent = cameraErrorMessage(err, isNative());
      // Refused before: ask again where the platform still lets us, else say
      // where the switch is; "Try again" / a fresh grant restarts the scan.
      const refused = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      if (refused && !reasked && !done && (await cameraAskAgain()) && !done) {
        reasked = true;
        status.textContent = 'Point the camera at the barcode.';
        start();
      }
    }
  };
  start();
}

/* Full-screen "Estimating calories" while a food save runs: food drops onto a
   plate, steam rises, three lines take turns. CSS only (app.css "Food
   loader"); a still plate under reduced motion. Shown after 200ms so a fast
   save does not flash it. Returns the hide function. */
function showFoodLoader(foodName) {
  const bit = (cls) => h('span', { class: 'gb-fl-bit ' + cls });
  const node = h(
    'div',
    { class: 'gb-food-loader', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'gb-fl-art', 'aria-hidden': 'true' },
      h('div', { class: 'gb-fl-steam' }, h('i'), h('i'), h('i')),
      h(
        'div',
        { class: 'gb-fl-plate' },
        bit('is-wrap'),
        bit('is-tomato'),
        bit('is-leaf'),
        bit('is-fruit')
      )
    ),
    h('div', { class: 'gb-fl-title' }, 'Estimating calories'),
    foodName ? h('div', { class: 'gb-fl-sub' }, foodName) : null,
    h('div', { class: 'gb-fl-bar', 'aria-hidden': 'true' }, h('span')),
    h(
      'div',
      { class: 'gb-fl-steps', 'aria-hidden': 'true' },
      h('span', null, 'Reading what you ate'),
      h('span', null, 'Sizing up the portion'),
      h('span', null, 'Adding up the calories')
    )
  );
  const timer = setTimeout(() => document.body.appendChild(node), 200);
  return () => {
    clearTimeout(timer);
    node.remove();
  };
}

/* The instant to file an entry under, from a picked day. Today keeps the real
   clock time so the day's list stays in order and shows a sensible one. A past
   day gets local noon: the server re-derives the date in the user's own zone,
   and noon is the one hour that lands on the same day whatever that zone is. */
function loggedAtFor(dayKey) {
  if (!dayKey || dayKey === todayKey()) return new Date().toISOString();
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/* Sleep and mood: paint, POST, and on no connection or a 5xx (Render waking)
   queue the same POST in the outbox — both are upserts by date, so a replay is
   safe — and loadSecondaryData lays queued ones over the server's logs. They
   used to say "saved locally" and be wiped by the next load. A refusal (4xx)
   puts the day back and says so. `quiet`: no success toast (a one-tap chip). */
async function postWellness(kind, byDate, entry, body, okMsg, failMsg, quiet) {
  const key = entry.date;
  state.wellness = Object.assign(emptyWellness(), state.wellness || {});
  const prev = (state.wellness[byDate] || {})[key];
  state.wellness[byDate] = Object.assign({}, state.wellness[byDate] || {}, { [key]: entry });
  persistWellness();
  render();
  const path = '/api/daily-logs/' + kind;
  const idemKey = newIdemKey();
  try {
    await api(path, { method: 'POST', body, headers: { 'Idempotency-Key': idemKey } });
    if (!quiet) toastSuccess(okMsg);
  } catch (err) {
    if (err && err.sessionEnded) return; // signed out meanwhile: state is the next account's
    if (networkError(err) || err.status >= 500) {
      await queueWrite({ method: 'POST', path, body, kind: 'wellness.' + kind, idemKey, local: entry });
      return;
    }
    // A newer save (or the server's copy) has replaced this one: nothing of it left to undo.
    // By value: the cache hydrating mid-request rebuilds this same entry as a new object.
    if (JSON.stringify((state.wellness[byDate] || {})[key]) !== JSON.stringify(entry)) return;
    const map = Object.assign({}, state.wellness[byDate]);
    if (prev) map[key] = prev;
    else delete map[key];
    state.wellness = Object.assign({}, state.wellness, { [byDate]: map });
    persistWellness();
    render();
    toastError(err, failMsg);
  }
}

async function saveSleepEntry(payload, opts) {
  const key = payload.date || todayKey();
  // A quick "Yes" names the times only: keep the day's own quality, never
  // invent one (it used to save "okay"/last night's and Report averaged it).
  const had = ((state.wellness && state.wellness.sleepByDate) || {})[key] || {};
  const quality = payload.quality || had.quality || null;
  const entry = {
    date: key,
    bedtime: payload.bedtime || '',
    wakeTime: payload.wakeTime || '',
    quality,
    note: payload.note || '',
    updatedAt: new Date().toISOString(),
  };
  const body = JSON.stringify({
    date: key,
    bedtime: payload.bedtime || null,
    wakeTime: payload.wakeTime || null,
    quality,
    note: payload.note || null,
  });
  await postWellness('sleep', 'sleepByDate', entry, body, 'Sleep saved.', 'Sleep was not saved.', opts && opts.quiet);
  autoTickHealthHabits(); // a "Sleep well" habit linked to sleep
}

async function saveMoodEntry(payload) {
  const key = payload.date || todayKey();
  // A quick mood tap names the mood only: it keeps what the day already had
  // and invents no energy (it used to record "medium" nobody chose).
  const prev = ((state.wellness && state.wellness.moodByDate) || {})[key] || {};
  const energy = payload.energy || prev.energy || null;
  const stress = payload.stress || prev.stress || null;
  const note = payload.note !== undefined ? payload.note : prev.note;
  const entry = {
    date: key,
    mood: payload.mood || 'okay',
    energy,
    stress,
    note: note || '',
    updatedAt: new Date().toISOString(),
  };
  const body = JSON.stringify({
    date: key,
    mood: payload.mood || 'okay',
    energy,
    stress,
    note: note || null,
  });
  await postWellness('mood', 'moodByDate', entry, body, 'Check-in saved.', 'Check-in was not saved.');
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
        date: todayKey(),
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
    body: JSON.stringify({ foodName, mealType, confidence, fallbackNeeded, date: todayKey() }),
  }).catch((err) => {
    console.error('CRITICAL: rememberPhotoFood failed to reach database:', err);
  });
}

/* Home's one-tap mood. `night` is the "Slept 23:25 to 06:45?" row showing just
   above it (WellnessQuick), and the same tap logs that night too: the morning
   check-in is one tap, not two (FRC-9). The toast's Edit is the sleep dialog,
   for a night that wasn't that one. */
async function quickMood(mood, night) {
  quietSuccess++;
  try {
    await saveMoodEntry({ mood });
    if (night) await saveSleepEntry({ bedtime: night.bedtime, wakeTime: night.wakeTime }, { quiet: true });
  } finally {
    quietSuccess--;
  }
  if (!night) return toastSuccess('Check-in saved.');
  pushToast(
    'Mood saved, and last night ' + formatTime(night.bedtime) + ' to ' + formatTime(night.wakeTime) + ' logged.',
    'success',
    6000,
    { label: 'Edit', run: openSleepSchedule }
  );
}

function openSleepSchedule() {
  const today = todayKey();
  const existing = (state.wellness.sleepByDate || {})[today] || {};
  // An unlogged night opens on the phone's, the usual or the last one, so a normal night is one tap on Save.
  const usual = lastNightGuess(state.wellness.sleepByDate, today, state.phoneNight) || {
    bedtime: '23:00',
    wakeTime: '07:00',
  };
  const dateInput = h('input', { type: 'date', class: 'gb-input', value: existing.date || today });
  const bedInput = h('input', {
    type: 'time',
    class: 'gb-input',
    value: existing.bedtime || usual.bedtime,
  });
  const wakeInput = h('input', {
    type: 'time',
    class: 'gb-input',
    value: existing.wakeTime || usual.wakeTime,
  });
  const quality = segmented(
    [
      { value: 'low', label: 'Low' },
      { value: 'okay', label: 'Okay' },
      { value: 'good', label: 'Good' },
      { value: 'great', label: 'Great' },
    ],
    existing.quality || usual.quality || 'okay'
  );
  const noteInput = h(
    'textarea',
    { class: 'gb-input gb-input--about', maxlength: '280', placeholder: 'Optional note' },
    existing.note || ''
  );
  // Which night the date means (the one that ended that morning) and how long
  // it was, live: it used to say "for today" whatever night was being edited.
  const nightLine = h('div', { class: 'gb-field-hint', 'aria-live': 'polite' });
  const paintNight = () => {
    const day = dateInput.value || today;
    const y = new Date(today + 'T12:00:00');
    y.setDate(y.getDate() - 1);
    const night =
      day === today
        ? 'Last night'
        : day === keyOfDate(y)
          ? 'The night before last'
          : 'The night into ' + new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const toMin = (v) => {
      const m = /^(\d{2}):(\d{2})/.exec(v || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const b = toMin(bedInput.value);
    const w = toMin(wakeInput.value);
    const mins = b == null || w == null ? null : (w - b + 1440) % 1440;
    nightLine.textContent =
      night + (mins ? ' · ' + Math.floor(mins / 60) + ' h' + (mins % 60 ? ' ' + (mins % 60) + ' min' : '') : '');
  };
  [dateInput, bedInput, wakeInput].forEach((el) => el.addEventListener('input', paintNight));
  paintNight();
  openModal({
    title: 'Sleep',
    sub: 'Bedtime, wake time and quality for one night.',
    body: h(
      'div',
      { class: 'gb-form' },
      nightLine,
      h('div', { class: 'gb-field-label' }, 'Morning you woke up'),
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
  const today = todayKey();
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

/* Plan my day: a draft the user only has to accept. Today's reminders, bills
   due, habits not yet done and the three most pressing tasks, each task given a
   free hour (day-plan.js). Accepting turns the ticked task blocks into today's
   reminders, so the plan rings; everything else is already in the app. No AI. */
// day-plan.js loads on the tap: it is only ever needed here, and the boot chunk is over budget.
async function openDailyPlan() {
  const { buildDayPlan, planTarget } = await import('./day-plan.js');
  const zone = state.user && state.user.timezone;
  // After 21:00 no block fits today, so the draft is tomorrow's (FRC-8): it used
  // to list the morning's gone reminders and a "Looks good" that wrote nothing.
  // The account's day and clock both: the device's hour beside it mixed two zones.
  const target = planTarget(todayKey(), zoneMinutes(zone));
  const today = target.day;
  const plan = buildDayPlan({
    tasks: state.tasks,
    // Tomorrow every habit is still to do.
    habits: !featureOn('habits') ? [] : target.tomorrow ? state.habits.map((hb) => ({ ...hb, doneToday: false })) : state.habits,
    reminders: state.reminders,
    subscriptions: featureOn('money') && state.money ? state.money.subscriptions : [],
    today,
    nowMin: target.nowMin,
    zone,
  });
  const ICON = { reminder: 'bell', bill: 'wallet', habit: 'repeat', task: 'list-checks' };
  const LABEL = { reminder: 'Reminder', bill: 'Bill', habit: 'Habit', task: 'Focus block' };
  const blocks = []; // { item, box, timeInput }
  const rows = plan.map((item) => {
    const copy = h(
      'span',
      { class: 'gb-plan-copy' },
      h('strong', null, item.title),
      h('span', null, [LABEL[item.kind], item.detail].filter(Boolean).join(' \u00b7 '))
    );
    if (item.kind === 'task' && item.block) {
      const box = h('input', {
        type: 'checkbox',
        class: 'gb-qa-check',
        checked: true,
        'aria-label': 'Block time for ' + item.title,
      });
      const timeInput = h('input', {
        type: 'time',
        class: 'gb-input gb-plan-time-input',
        value: item.time,
        'aria-label': 'Start time for ' + item.title,
      });
      blocks.push({ item, box, timeInput });
      return h('label', { class: 'gb-plan-row gb-plan-row--pick' }, box, copy, timeInput);
    }
    return h(
      'div',
      { class: 'gb-plan-row' },
      h('span', { class: 'gb-plan-time' }, item.time ? formatTime(item.time) : ''),
      h('span', { class: 'gb-plan-icon' }, Icon(ICON[item.kind], { size: 17, sw: 2.4 })),
      copy
    );
  });
  // The day's care items stay as one line each: they are a tap elsewhere, not a
  // block. Tomorrow's plan has none: they are about today.
  const care = [];
  const sleep = (state.wellness.sleepByDate || {})[today];
  const mood = (state.wellness.moodByDate || {})[today];
  if (!target.tomorrow) {
    if (featureOn('water') && state.water) {
      const left = (state.water.goalMl || 2000) - (state.water.consumedMl || 0);
      if (left > 0) care.push({ icon: 'droplets', text: left + ' ml of water to go' });
    }
    if (!sleep) care.push({ icon: 'moon', text: 'Log last night\u2019s sleep' });
    if (!mood) care.push({ icon: 'heart', text: 'A 20-second mood check-in' });
  }
  const careRows = care.map((c) =>
    h(
      'div',
      { class: 'gb-plan-row' },
      h('span', { class: 'gb-plan-time' }),
      h('span', { class: 'gb-plan-icon' }, Icon(c.icon, { size: 17, sw: 2.4 })),
      h('span', { class: 'gb-plan-copy' }, h('span', null, c.text))
    )
  );
  const empty = !rows.length && !careRows.length;
  openModal({
    title: target.tomorrow ? 'Tomorrow plan' : 'Today plan',
    sub:
      (target.tomorrow ? 'Today is nearly done, so this is tomorrow, drafted' : 'Drafted') +
      ' from your tasks, reminders, habits and bills.' +
      (blocks.length ? ' Untick a block you don\u2019t want, or move its time.' : ''),
    body: h(
      'div',
      { class: 'gb-plan-list' },
      empty
        ? h(
            'p',
            { class: 'gb-plan-empty' },
            'Nothing is waiting on you ' + (target.tomorrow ? 'tomorrow' : 'today') + '. Add a task to plan around.'
          )
        : null,
      rows,
      careRows
    ),
    primary: blocks.length ? (target.tomorrow ? 'Add to tomorrow' : 'Add to my day') : 'Looks good',
    errorMessage: 'Could not add the plan.',
    onPrimary: async () => {
      const picked = blocks.filter((b) => b.box.checked && b.timeInput.value);
      let added = 0;
      for (const b of picked) {
        // addReminder refuses a time already gone and says so; the rest still land.
        const made = await addReminder(today, 'Focus: ' + b.item.title, b.timeInput.value, 'personal', 'none', null, '', addMinutesHHMM(b.timeInput.value, 60));
        if (made) added++;
      }
      if (picked.length && !added) throw new Error('None of those blocks could be added.');
    },
  });
}

/** "HH:MM" plus minutes, capped at 23:59 (a block can't run into tomorrow). */
function addMinutesHHMM(hhmmStr, mins) {
  const [hh, mm] = hhmmStr.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, hh * 60 + mm + mins);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

async function addSuggestedReminder(text, time, tag) {
  await addReminder(todayKey(), text, time || '19:00', tag || 'personal', 'none', null);
}

/* The "recent foods" chips: GET /api/food/recent, kept for the session and
   dropped by every log. null = not asked yet. */
let recentFoods = null;
const FUTURE_FOOD = "You can't log food for a day that hasn't happened yet.";

/* Log food closes on the tap: the save, and the estimate behind it when no
   kcal was typed, carry on under the screen (they held the dialog ~11 s). An
   estimate gets the plate animation (showFoodLoader) while it runs. A failure
   keeps the entry on a Retry toast rather than losing what was typed. */
function logFoodLater(payload, opts) {
  const hide = payload.kcal == null ? showFoodLoader(payload.foodName) : null;
  logFoodEntry(payload, opts)
    .catch((err) =>
      pushToast((err && err.message) || 'Could not log ' + payload.foodName + '.', 'error', 10000, {
        label: 'Retry',
        run: () => logFoodLater(payload, opts),
      })
    )
    .finally(() => hide && hide());
}

/* opts.file: a plate photo already taken (the Photo option in Quick add);
   estimated as soon as the form opens, as if picked with its own button. */
function openAddFood(opts) {
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
  // Which meal: defaulted from the hour now (nutrition.js, same hours as the
  // server's MealSlot.forHour); the Food card groups by it.
  const slotSeg = segmented(
    MEAL_SLOTS.map((m) => ({ value: m.key, label: m.key === 'snack' ? 'Snack' : m.label })),
    mealSlotAt(new Date())
  );
  slotSeg.node.setAttribute('aria-label', 'Meal slot');
  /* Figures from a label the form was filled from: a barcode product (per
     100 g, scaled at save) or a favourite (its own portion). Sent only while the
     name still matches, so typing a different food drops them. */
  let label = null; // { kind: 'barcode', name, product } | { kind: 'fav', name, fav }

  const foodNameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Rava dosa with chutney',
    maxlength: 255,
    'aria-label': 'Food',
  });
  // Pieces or grams: nobody weighs dosas, but a packet says grams. Pieces is
  // the default because it's what most plates are counted in.
  const UNITS = {
    pcs: { min: 1, max: 30, placeholder: '2', name: 'pieces' },
    g: { min: 10, max: 2000, placeholder: '180', name: 'grams' },
  };
  const quantityInput = h('input', {
    type: 'number',
    inputmode: 'numeric',
    placeholder: UNITS.pcs.placeholder,
    min: String(UNITS.pcs.min),
    max: String(UNITS.pcs.max),
    step: '1',
    'aria-label': 'Amount in pieces',
  });
  const unitSeg = segmented(
    [
      { value: 'pcs', label: 'pcs' },
      { value: 'g', label: 'g' },
    ],
    'pcs',
    (u) => {
      quantityInput.placeholder = UNITS[u].placeholder;
      quantityInput.min = String(UNITS[u].min);
      quantityInput.max = String(UNITS[u].max);
      quantityInput.setAttribute('aria-label', 'Amount in ' + UNITS[u].name);
      if (!quietUnit) quantityInput.focus();
    }
  );
  unitSeg.node.setAttribute('aria-label', 'Unit');
  // Calories, typed. Everything else on this form feeds an estimator; this one
  // overrides it. Someone holding the packet knows the number better than any
  // guess we can make from a food name, and a manual entry costs no lookup and
  // no AI call.
  const kcalInput = h('input', {
    type: 'number',
    inputmode: 'numeric',
    placeholder: 'Auto',
    min: '1',
    max: '5000',
    step: '1',
    'aria-label': 'Calories (optional)',
  });
  const platePhotoInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
  });

  const itemsContainer = h('div', {
    class: 'gb-food-items-container',
    style: { marginTop: '16px', display: 'none' },
  });

  function createItemRow(item, index) {
    // A textarea that grows to the name (field-sizing in app.css): a scanned
    // dish is often a long name, and one line cut it to a few words on a phone.
    const nameInput = h('textarea', {
      class: 'gb-input gb-input--inline gb-food-item-name',
      rows: 1,
      placeholder: 'Food name',
      'aria-label': 'Food name',
      maxlength: 100,
    });
    nameInput.value = item.foodName || '';
    // One line of text: Enter ends the edit instead of starting a new line.
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });

    const quantityInput = h('input', {
      type: 'number',
      class: 'gb-input gb-input--inline',
      value: item.quantityGrams || '',
      placeholder: 'g',
      'aria-label': 'Grams of ' + (item.foodName || 'this item'),
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
        'aria-label': 'Remove ' + (item.foodName || 'item'),
        onclick: () => {
          photoItems.splice(index, 1);
          renderItemsList();
        },
        style: { padding: '4px 8px', minHeight: '36px' },
      },
      Icon('x', { size: 14 })
    );

    const updateItem = () => {
      const newQty = parseInt(quantityInput.value);
      if (Number.isFinite(newQty) && newQty > 0) {
        photoItems[index] = {
          foodName: nameInput.value.replace(/\s+/g, ' ').trim() || item.foodName,
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

  async function estimateFromPhoto(file = platePhotoInput.files && platePhotoInput.files[0]) {
    if (!file) {
      throw new Error('Please choose a photo first.');
    }
    // Shrunk like every other scan: a raw camera photo (3+ MB) is over the
    // server's 2,000,000-char cap once base64'd, so it always 400'd.
    const dataUrl = await import('./notes.js').then((m) => m.shrinkPhoto(file));
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

  /* Backdating. The server already took an entry's own `loggedAt` and filed the
     day from it — the form just never offered a day, so everything landed on
     now. `max` is today: a meal you haven't eaten yet is not a log. */
  const dateInput = h('input', {
    type: 'date',
    class: 'gb-input',
    value: todayKey(),
    max: todayKey(),
    'aria-label': 'Day this food was eaten',
  });

  // The scan starts as soon as a photo is picked: choosing one and then also
  // pressing "Analyze" was two taps for one intent.
  const photoBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--secondary gb-food-photo-btn',
      onclick: () => platePhotoInput.click(),
    },
    Icon('camera', { size: 16, sw: 2.2 }),
    'Scan a plate photo instead'
  );
  async function estimatePlate(file) {
    // One estimate at a time: a second tap mid-call used to send the photo twice.
    const done = setThinking(photoBtn, 'Looking at your plate');
    try {
      await estimateFromPhoto(file);
    } catch {
      const safeMsg = 'Could not analyze photo. Please enter manually.';
      toastError({ message: safeMsg }, safeMsg);
    } finally {
      done();
      platePhotoInput.value = ''; // picking the same photo again must fire again
    }
  }
  platePhotoInput.addEventListener('change', () => {
    if (platePhotoInput.files && platePhotoInput.files[0]) estimatePlate();
  });

  const field = (label, control) =>
    h('label', { class: 'gb-food-field' }, h('span', { class: 'gb-field-label' }, label), control);

  /* "Had before": favourites (starred, first) then recent foods, one row under
     the Food field. A tap logs that food at once with its own portion and
     calories (typed, so no estimate) on the day and slot below. One line that
     scrolls sideways, filtered by what is typed: wrapped, a full list pushed
     Amount and Calories off a phone screen and buried the field itself. */
  let closeDialog = () => {};
  const chipRow = h('div', { class: 'gb-food-recent', role: 'group', 'aria-label': 'Foods you had before' });
  const known = () => {
    const seen = new Set();
    return [
      ...(favouriteFoods || []).map((f) => ({ foodName: f.foodName, quantityGrams: f.quantityGrams, kcal: f.kcal, fav: f })),
      ...(recentFoods || []).map((r) => ({
        foodName: r.foodName,
        quantityGrams: r.quantityGrams,
        kcal: r.kcalEstimated,
        pieces: r.pieces || null,
        mealType: r.mealType,
      })),
    ].filter((x) => {
      const k = String(x.foodName || '').trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const logAgain = (x) => {
    if (dateInput.value > todayKey()) {
      toastError(null, FUTURE_FOOD);
      return;
    }
    const f = x.fav;
    closeDialog();
    logFoodLater({
      foodName: x.foodName,
      quantityGrams: x.quantityGrams,
      pieces: x.pieces || null,
      mealType: x.mealType || mealTypeSeg.get(),
      mealSlot: slotSeg.get(),
      kcal: x.kcal,
      loggedAt: loggedAtFor(dateInput.value),
      note: null,
      ...(f ? { proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, fiberG: f.fiberG } : {}),
    }, { undo: true }); // a one-tap log toasts with Undo (main's chip did)
  };
  const paintChips = () => {
    const q = foodNameInput.value.trim().toLowerCase();
    const list = known().filter((x) => !q || x.foodName.toLowerCase().includes(q));
    chipRow.replaceChildren(
      ...list.map((x) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-food-recent-chip' + (x.fav ? ' is-fav' : ''),
            'aria-label': 'Log ' + x.foodName + ' again, ' + x.kcal + ' kcal',
            onclick: () => logAgain(x),
          },
          x.fav ? Icon('star', { size: 12, sw: 2.4 }) : null,
          x.foodName
        )
      )
    );
    chipRow.hidden = !list.length;
  };

  /* Kcal the form filled in itself follows the grams until typed over: a
     barcode's label, or the last portion of a food typed by name. */
  let autoKcal = '';
  let kcalFor = null; // (amount, unit) -> kcal for the food the form filled
  let filledFor = ''; // ...and its name; typing another food drops both
  let quietUnit = false;
  const toGrams = () => {
    if (unitSeg.get() === 'g') return;
    // segmented() has no setter; a click runs its own onChange (min/max/label).
    quietUnit = true;
    unitSeg.node.children[1].click();
    quietUnit = false;
  };
  quantityInput.addEventListener('input', () => {
    if (!kcalFor || kcalInput.value !== autoKcal) return;
    const n = Number(quantityInput.value);
    const k = n >= UNITS[unitSeg.get()].min ? kcalFor(n, unitSeg.get()) : null;
    kcalInput.value = k != null ? String(k) : '';
    autoKcal = kcalInput.value;
  });
  // A food typed by hand that was had before starts on that portion (by the
  // piece if it was counted) and its calories, so the save is instant (no
  // estimate); both stay editable. Never over a number already typed.
  const remember = () => {
    const name = foodNameInput.value.trim().toLowerCase();
    const r = name && known().find((x) => x.foodName.trim().toLowerCase() === name);
    if (!r || !r.quantityGrams || quantityInput.value !== '') return;
    label = r.fav ? { kind: 'fav', name: r.foodName, fav: r.fav } : null;
    const unit = r.pieces ? 'pcs' : 'g';
    const base = r.pieces || r.quantityGrams;
    if (unit === 'g') toGrams();
    else if (unitSeg.get() !== 'pcs') {
      quietUnit = true;
      unitSeg.node.children[0].click();
      quietUnit = false;
    }
    quantityInput.value = String(base);
    if (kcalInput.value === '' && r.kcal) {
      kcalInput.value = autoKcal = String(r.kcal);
      kcalFor = (n, u) => (u === unit ? Math.round((r.kcal * n) / base) : null);
      filledFor = name;
    }
  };
  foodNameInput.addEventListener('change', remember);
  foodNameInput.addEventListener('input', () => {
    paintChips();
    if (!filledFor || foodNameInput.value.trim().toLowerCase() === filledFor) return;
    if (kcalInput.value === autoKcal) kcalInput.value = '';
    kcalFor = null;
    filledFor = '';
  });
  if (!favouriteFoods) loadFavouriteFoods().then(paintChips);
  if (!recentFoods)
    api('/api/food/recent')
      .then((list) => {
        recentFoods = Array.isArray(list) ? list : [];
        paintChips();
      })
      .catch(() => {});
  paintChips();

  /* Barcode: the product's per-100 g label from OpenFoodFacts (GET
     /api/food/barcode/{code}, no AI) fills name, grams (its serving, else 100)
     and kcal; the grams can still change and the kcal follows them until typed. */
  const fillBarcode = (p) => {
    label = { kind: 'barcode', name: p.name, product: p };
    const grams = p.servingGrams || 100;
    const k = labelFor(p, grams).kcal;
    foodNameInput.value = p.name;
    toGrams();
    quantityInput.value = String(grams);
    kcalInput.value = autoKcal = k != null ? String(k) : '';
    kcalFor = (n, u) => (u === 'g' ? labelFor(p, n).kcal : null);
    filledFor = String(p.name || '').trim().toLowerCase();
    paintChips();
  };
  const barcodeBtn = canScanBarcode()
    ? h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-food-photo-btn',
          onclick: () =>
            openBarcodeScanner(async (code) => {
              const done = setThinking(barcodeBtn, 'Looking it up');
              try {
                fillBarcode(await api('/api/food/barcode/' + encodeURIComponent(code)));
                toastSuccess('Found it. Check the amount, then add.');
              } catch (err) {
                toastError(err && err.status === 404 ? null : err, 'That product isn’t in the database. Type it in instead.');
              } finally {
                done();
              }
            }),
        },
        Icon('scan-barcode', { size: 16, sw: 2.2 }),
        'Scan a barcode'
      )
    : null;
  // The food first, focused, with what was had before right under it; the
  // fields that have a default (day, home/hotel, slot) come after the amount.
  const body = h(
    'div',
    { class: 'gb-form gb-food-form' },
    field('Food', foodNameInput),
    chipRow,
    h(
      'div',
      { class: 'gb-food-pair' },
      h(
        'div',
        { class: 'gb-food-field' },
        h('span', { class: 'gb-field-label' }, 'Amount'),
        h('div', { class: 'gb-affix' }, quantityInput, unitSeg.node)
      ),
      field(
        'Calories',
        h('div', { class: 'gb-affix' }, kcalInput, h('span', { class: 'gb-affix-unit' }, 'kcal'))
      )
    ),
    h(
      'div',
      { class: 'gb-field-hint gb-food-hint' },
      'Leave either blank and we’ll estimate it. Typed calories are used exactly.'
    ),
    h(
      'div',
      { class: 'gb-food-pair' },
      field('Day', dateInput),
      h(
        'div',
        { class: 'gb-food-field' },
        h('span', { class: 'gb-field-label' }, 'Meal'),
        mealTypeSeg.node
      )
    ),
    h('div', { class: 'gb-food-field' }, h('span', { class: 'gb-field-label' }, 'Slot'), slotSeg.node),
    barcodeBtn,
    photoBtn,
    platePhotoInput,
    itemsContainer
  );

  const loggedItems = new Set();
  closeDialog = openModal({
    title: 'Log food',
    body,
    primary: 'Add food',
    errorMessage: 'Could not log food right now.',
    onPrimary: async () => {
      let entriesToAdd = [];
      const mealType = mealTypeSeg.get();
      // A typed date skips the picker's max; YYYY-MM-DD compares as text.
      if (dateInput.value > todayKey()) throw fieldRefusal(dateInput, FUTURE_FOOD);

      // If we have photo items, use them
      if (photoItems.length > 0) {
        const loggedAtNow = loggedAtFor(dateInput.value);
        entriesToAdd = photoItems.filter((item) => !loggedItems.has(item)).map((item) => ({
          item,
          foodName: item.foodName,
          quantityGrams: item.quantityGrams,
          mealType: mealType,
          mealSlot: slotSeg.get(),
          loggedAt: loggedAtNow,
          note: photoDataUrl ? 'photo:' + (photoConfidence >= 0.7 ? 'used' : 'fallback') : null,
        }));
      } else {
        // Otherwise use manual input. Enter in the Food field can beat its
        // change event here, so the remembered portion is applied first.
        remember();
        const foodName = foodNameInput.value.trim();
        const quantityRaw = quantityInput.value ? Number(quantityInput.value) : null;
        const unit = UNITS[unitSeg.get()];
        if (!foodName) throw fieldRefusal(foodNameInput, 'Type a food, or scan a photo.');
        if (
          quantityRaw != null &&
          (!Number.isFinite(quantityRaw) || quantityRaw < unit.min || quantityRaw > unit.max)
        ) {
          throw fieldRefusal(quantityInput, 'Amount must be ' + unit.min + ' to ' + unit.max + ' ' + unit.name + '.');
        }
        const pieces = quantityRaw != null && unit === UNITS.pcs ? Math.round(quantityRaw) : null;
        const grams = quantityRaw != null && unit === UNITS.g ? Math.round(quantityRaw) : null;
        const kcalRaw = kcalInput.value ? Number(kcalInput.value) : null;
        // The ceiling is one meal, not one day — a typed 50,000 is a slipped
        // finger. Say so here rather than letting the server answer 400.
        if (kcalRaw != null && (!Number.isFinite(kcalRaw) || kcalRaw < 1 || kcalRaw > 5000)) {
          throw fieldRefusal(kcalInput, 'Calories must be between 1 and 5,000 for a single entry.');
        }
        // A label's figures ride along only for the food it described, in grams,
        // with typed kcal (the server ignores them on an estimate anyway).
        let figures = {};
        if (label && label.name === foodName && grams != null && kcalRaw != null) {
          if (label.kind === 'barcode') {
            figures = labelFor(label.product, grams);
            delete figures.kcal; // the field's own figure, typed or followed
          } else if (grams === label.fav.quantityGrams) {
            const f = label.fav;
            figures = { proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, fiberG: f.fiberG };
          }
        }
        // The dialog closes on the tap; the save (and an estimate, ~10 s of AI)
        // carries on under the screen.
        logFoodLater({
          foodName: foodName,
          quantityGrams: grams,
          pieces,
          mealType: mealType,
          mealSlot: slotSeg.get(),
          kcal: kcalRaw != null ? Math.round(kcalRaw) : null,
          loggedAt: loggedAtFor(dateInput.value),
          note: null,
          ...figures,
        });
        return;
      }

      // A plate's items, one after another. Each is an AI estimate, so the wait
      // gets the whole screen rather than a busy button.
      const hideLoader = showFoodLoader(entriesToAdd.map((e) => e.foodName).join(', '));
      try {
        for (const { item, ...entry } of entriesToAdd) {
          await logFoodEntry(entry);
          // A later item failing keeps the dialog open; a retry must not log this one twice.
          if (item) loggedItems.add(item);
        }
      } finally {
        hideLoader();
      }

      rememberPhotoFood(
        photoItems.map((i) => i.foodName).join(', '),
        { confidence: photoConfidence, fallbackNeeded: photoFallbackNeeded },
        !!photoDataUrl
      );
    },
  });

  if (opts && opts.file instanceof Blob) estimatePlate(opts.file);
  else focusSoon(foodNameInput);
}

/* A second tap on a row's delete before the first answered sent a second
   DELETE, which 404'd and toasted "Could not delete" over a delete that worked. */
const entryDeletesInFlight = new Set();

/* A day summary's entry taken out, or put back at `at`, with the totals that
   counted it. `fix(summary, entry, sign)` moves the totals. */
function summarySlot(get, set, id, fix) {
  let item = null;
  let at = 0;
  return {
    remove() {
      const s = get();
      const list = (s && s.entries) || [];
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) return;
      item = list[i];
      at = i;
      set({ ...fix(s, item, -1), entries: list.filter((e) => e.id !== id) });
    },
    restore() {
      const s = get();
      const list = (s && s.entries) || [];
      if (!item || !s || list.some((e) => e.id === id)) return;
      set({ ...fix(s, item, 1), entries: [...list.slice(0, at), item, ...list.slice(at)] });
    },
  };
}

/* Both row deletes are one tap on a small x: undoable (deferDelete), so they
   need no confirm. */
function deleteWaterEntry(entryId) {
  // Still in flight from quickAddWater: there is no server id to delete yet.
  if (pendingWater.has(entryId)) return;
  const key = 'water:' + entryId;
  if (entryDeletesInFlight.has(key)) return;
  deferDelete({
    message: 'Water entry deleted.',
    errorText: 'Could not delete that water entry.',
    selector: '[data-water-id="' + entryId + '"]',
    ...summarySlot(
      () => state.water,
      (w) => (state.water = w),
      entryId,
      (w, e, sign) => {
        const consumedMl = Math.max(0, (w.consumedMl || 0) + sign * (e.effectiveMl ?? effectiveMl(e.amountMl, e.drinkType)));
        return {
          ...w,
          consumedMl,
          drankMl: Math.max(0, (w.drankMl || 0) + sign * (e.amountMl || 0)),
          remainingMl: Math.max(0, (w.goalMl || 0) - consumedMl),
        };
      }
    ),
    commit: async () => {
      entryDeletesInFlight.add(key);
      try {
        const updated = await api('/api/water/entries/' + entryId, { method: 'DELETE', keepalive: true });
        if (!state.user) return;
        state.water = withPendingWater(updated);
        invalidateWeek('water');
        render();
      } finally {
        entryDeletesInFlight.delete(key);
      }
    },
  });
}

/* The Summary screen's data. Fetched when the screen opens, not at boot: the
   food half may run an AI protein estimate on the server. A write drops the half
   it changed (refetched at once if the screen is showing), and a food write also
   drops the diet check, which judged the week's dish names and no longer
   describes it. `weekGen` throws away an answer that was in flight across a
   write or a sign-out, so neither a stale week nor the last account's lands. */
const weekGen = generation();
let weekInFlight = null;
function loadWeekSummary() {
  if (weekInFlight === weekGen.now()) return;
  const gen = (weekInFlight = weekGen.now());
  state.weekError = '';
  Promise.all([
    state.foodWeek || api('/api/food/week'),
    state.waterWeek || api('/api/water/week'),
  ])
    .then(([f, w]) => {
      if (weekGen.isStale(gen)) return;
      state.foodWeek = f;
      state.waterWeek = w;
    })
    .catch((err) => {
      if (!weekGen.isStale(gen)) state.weekError = (err && err.message) || 'Could not load your week.';
    })
    .finally(() => {
      if (weekInFlight === gen) weekInFlight = null;
      if (state.screen !== 'summary') return;
      if (weekGen.isStale(gen)) loadWeekSummary();
      else render();
    });
}

function invalidateWeek(kind) {
  weekGen.bump();
  // Water is part of Buddy's read too, so any change drops it. Progress charts
  // today's water from the trends row, which is written at load: every water
  // write passes here, so that row is kept in step too.
  applyWeekInvalidation(state, kind, todayKey());
  if (state.screen === 'summary') loadWeekSummary();
}

// date: a YYYY-MM-DD to read that one day; omitted, the week.
async function runDietCheck(date) {
  const gen = weekGen.now();
  const scope = date ? 'day' : 'week';
  state.dietCheck = { loading: true, scope, date };
  render();
  if (date) revealBuddyCard();
  let next;
  try {
    const q = date ? '?date=' + encodeURIComponent(date) : '';
    next = { scope, date, data: await api('/api/food/diet-check' + q, { method: 'POST' }) };
  } catch (err) {
    next = { scope, date, error: (err && err.message) || 'Could not check your ' + scope + ' right now.' };
  }
  // An entry changed (or the account did) while Buddy was reading: drop it.
  if (weekGen.isStale(gen)) return;
  state.dietCheck = next;
  render();
  if (date) revealBuddyCard();
}

/* A day tapped in a chart is read in the Buddy card, which on a phone sits a
   screen below the chart. Scrolled once on the tap, the answer then grew the
   card downward past the fold and the tap looked dead, so it runs again when
   the answer lands. After render()'s own scroll restore, which also runs in a rAF. */
function revealBuddyCard() {
  requestAnimationFrame(() => {
    const card = document.querySelector('.gb-summary-buddy');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  });
}

/* Fix a logged meal: PUT /api/food/entries/{id}. Typed calories are kept as
   typed; new grams alone rescale the entry's own kcal/100 g; no AI either way.
   The answer is the summary of the day the entry ends up on. */
function openEditFood(entry) {
  const name = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: 255,
    value: entry.foodName || '',
    'aria-label': 'Food',
  });
  const grams = h('input', {
    type: 'number',
    class: 'gb-input',
    inputmode: 'numeric',
    min: '10',
    max: '2000',
    step: '1',
    value: String(entry.quantityGrams || ''),
    'aria-label': 'Amount in grams',
  });
  const kcal = h('input', {
    type: 'number',
    class: 'gb-input',
    inputmode: 'numeric',
    min: '1',
    max: '5000',
    step: '1',
    value: String(entry.kcalEstimated || ''),
    'aria-label': 'Calories',
  });
  const day = h('input', {
    type: 'date',
    class: 'gb-input',
    value: entry.logDate || todayKey(),
    max: todayKey(),
    'aria-label': 'Day this food was eaten',
  });
  const meal = segmented(
    [
      { value: 'home', label: 'Home' },
      { value: 'hotel', label: 'Hotel' },
    ],
    entry.mealType || 'home'
  );
  const slot = segmented(
    MEAL_SLOTS.map((m) => ({ value: m.key, label: m.key === 'snack' ? 'Snack' : m.label })),
    entry.mealSlot || mealSlotAt(entry.loggedAt)
  );
  slot.node.setAttribute('aria-label', 'Meal slot');
  /* The star saves this entry as it is on the server (name, grams, kcal,
     macros) into the favourites, at once; Save is for the fields. */
  const isStarred = () =>
    (favouriteFoods || []).some(
      (f) => f.foodName.toLowerCase() === String(entry.foodName || '').trim().toLowerCase()
    );
  const star = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--secondary gb-food-star', 'aria-pressed': 'false' },
    Icon('star', { size: 16, sw: 2.2 }),
    h('span', null, 'Save as favourite')
  );
  const paintStar = () => {
    const on = isStarred();
    star.setAttribute('aria-pressed', String(on));
    star.classList.toggle('is-on', on);
    star.lastChild.textContent = on ? 'Saved as favourite' : 'Save as favourite';
  };
  star.addEventListener('click', async () => {
    const done = setThinking(star, isStarred() ? 'Removing' : 'Saving');
    try {
      await starFoodEntry(entry, !isStarred());
    } catch (err) {
      toastError(err, 'Could not change this favourite right now.');
    } finally {
      done();
      paintStar();
    }
  });
  loadFavouriteFoods().then(paintStar);
  const field = (label, control) =>
    h('label', { class: 'gb-food-field' }, h('span', { class: 'gb-field-label' }, label), control);
  openModal({
    title: 'Edit food',
    body: h(
      'div',
      { class: 'gb-form gb-food-form' },
      h(
        'div',
        { class: 'gb-food-pair' },
        field('Day', day),
        h('div', { class: 'gb-food-field' }, h('span', { class: 'gb-field-label' }, 'Meal'), meal.node)
      ),
      h('div', { class: 'gb-food-field' }, h('span', { class: 'gb-field-label' }, 'Slot'), slot.node),
      field('Food', name),
      h(
        'div',
        { class: 'gb-food-pair' },
        field('Amount', h('div', { class: 'gb-affix' }, grams, h('span', { class: 'gb-affix-unit' }, 'g'))),
        field('Calories', h('div', { class: 'gb-affix' }, kcal, h('span', { class: 'gb-affix-unit' }, 'kcal')))
      ),
      h('div', { class: 'gb-field-hint gb-food-hint' }, 'Change the grams alone and the calories follow.'),
      star
    ),
    primary: 'Save',
    errorMessage: 'Could not save this entry right now.',
    onPrimary: async () => {
      const foodName = name.value.trim();
      if (!foodName) {
        name.focus();
        throw new Error('Food name is required');
      }
      const g = Math.round(Number(grams.value));
      if (!Number.isFinite(g) || g < 10 || g > 2000) {
        grams.focus();
        throw new Error('Amount must be 10 to 2000 grams.');
      }
      const k = Math.round(Number(kcal.value));
      if (!Number.isFinite(k) || k < 1 || k > 5000) {
        kcal.focus();
        throw new Error('Calories must be between 1 and 5,000 for a single entry.');
      }
      if (day.value > todayKey()) {
        day.focus();
        throw new Error("You can't log food for a day that hasn't happened yet.");
      }
      const body = { foodName, mealType: meal.get(), mealSlot: slot.get(), date: day.value || entry.logDate };
      if (g !== entry.quantityGrams) body.quantityGrams = g;
      // Unchanged calories with new grams: let the server rescale them.
      if (k !== entry.kcalEstimated || g === entry.quantityGrams) body.kcal = k;
      const updated = await api('/api/food/entries/' + encodeURIComponent(entry.id), {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      recentFoods = null;
      // Moved to another day: today's card loses it, so refetch today's.
      if (updated && updated.date === todayKey()) state.food = updated;
      else if (state.food && (state.food.entries || []).some((e) => e.id === entry.id))
        state.food = await api('/api/food').catch(() => state.food);
      cacheFoodSummary(updated);
      if (entry.logDate && updated && entry.logDate !== updated.date)
        delete state.calendarFoodByDate[entry.logDate];
      invalidateWeek('food');
      render();
      toastSuccess('Food updated.');
    },
  });
  focusSoon(name);
}

// A day figure the entry carried moves with it; one it lacked stays as it is.
const shiftBy = (total, part, sign) => (total != null && part != null ? Math.max(0, total + sign * part) : total);

function deleteFoodEntry(entryId) {
  const key = 'food:' + entryId;
  if (entryDeletesInFlight.has(key)) return;
  // Where focus goes once the row is gone (it fell to <body>): the next
  // row's edit button, else the previous one's, else Log food.
  const ids = [...root.querySelectorAll('[data-food-id]')].map((el) => el.dataset.foodId);
  const at = ids.indexOf(String(entryId));
  const nextId = at < 0 ? null : ids[at + 1] || ids[at - 1] || null;
  deferDelete({
    message: 'Food entry deleted.',
    errorText: 'Could not delete that food entry.',
    selector: '[data-food-id="' + entryId + '"]',
    // After the render() that follows the row's exit.
    afterRemove: () =>
      queueMicrotask(() => {
        const target =
          (nextId && root.querySelector('[data-food-id="' + nextId + '"] .gb-food-row-edit')) ||
          root.querySelector('.gb-food-add');
        if (target) target.focus();
      }),
    ...summarySlot(
      () => state.food,
      (f) => (state.food = f),
      entryId,
      (f, e, sign) => ({
        ...f,
        totalCalories: shiftBy(f.totalCalories || 0, e.kcalEstimated || 0, sign),
        fiberG: shiftBy(f.fiberG, e.fiberG, sign),
        sugarG: shiftBy(f.sugarG, e.sugarG, sign),
        sodiumMg: shiftBy(f.sodiumMg, e.sodiumMg, sign),
      })
    ),
    commit: async () => {
      entryDeletesInFlight.add(key);
      try {
        const updated = await api('/api/food/entries/' + entryId, { method: 'DELETE', keepalive: true });
        if (!state.user) return;
        invalidateWeek('food');
        if (summaryIsForToday(updated, todayKey())) state.food = updated;
        cacheFoodSummary(updated);
        render();
      } finally {
        entryDeletesInFlight.delete(key);
      }
    },
  });
}

/* ---- Notification handlers ---- */
/* The bell is paged: NOTIF_PAGE rows at a time, "Load older" for the next
   (GET /api/notifications?limit=&before=&category=). `beyond` is the unread
   count the server has past what is loaded, so the badge still counts every
   unread card; `cursor`/`more` are per filter chip — a chip's rows newer than
   min(its own cursor, the All cursor) are all loaded, so that is where its
   next page starts. */
const NOTIF_PAGE = 30;
const NOTIF_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'habits', label: 'Habits' },
  { id: 'people', label: 'People' },
  { id: 'money', label: 'Money' },
  { id: 'system', label: 'System' },
];
let notifFilter = 'all';
let notifPaging = { cursor: {}, more: {}, beyond: 0, loading: false };

function notifPageUrl(filter, before) {
  const qs = new URLSearchParams({ limit: String(NOTIF_PAGE) });
  if (before) qs.set('before', before);
  if (filter && filter !== 'all') qs.set('category', filter);
  return '/api/notifications?' + qs;
}

/* A row from before the server stamped `category` reads it off its kind,
   as NotifyCategory.of does. */
function notifCategory(n) {
  if (n.category) return n.category;
  if (n.kind === 'reminder') return 'reminders';
  if (n.kind === 'habit_reminder') return 'habits';
  if (String(n.kind || '').startsWith('mentorship_')) return 'people';
  return 'system';
}

const notifTime = (n) => Date.parse(n.createdAt) || 0;
const oldestNotif = (list) =>
  list && list.length ? list.reduce((a, b) => (notifTime(b) < notifTime(a) ? b : a)).createdAt : null;

function setNotifFirstPage(list) {
  state.notifications = list || [];
  notifPaging = {
    cursor: { all: oldestNotif(state.notifications) },
    more: { all: state.notifications.length >= NOTIF_PAGE },
    beyond: 0,
    loading: false,
  };
}

/* The unread cards the server holds past the loaded pages. */
function syncNotifBeyond() {
  api('/api/notifications/unread-count')
    .then((r) => {
      const loaded = state.notifications.filter((n) => !n.readAt).length;
      notifPaging.beyond = Math.max(0, ((r && r.count) || 0) - loaded);
      repaintOverlays();
    })
    .catch(() => {});
}

function notifCursor(filter) {
  const all = notifPaging.cursor.all;
  const own = notifPaging.cursor[filter];
  if (filter === 'all' || !own) return all;
  if (!all) return own;
  return Date.parse(own) < Date.parse(all) ? own : all;
}

function notifHasMore(filter) {
  if (!notifPaging.more.all) return false; // the All stream reached the end: everything is loaded
  return filter === 'all' || !(filter in notifPaging.more) ? true : notifPaging.more[filter];
}

async function loadOlderNotifs() {
  if (notifPaging.loading) return;
  const filter = notifFilter;
  const before = notifCursor(filter);
  notifPaging.loading = true;
  repaintOverlays();
  try {
    const page = (await api(notifPageUrl(filter, before))) || [];
    // `before` is inclusive (a second-precision column), so the boundary rows repeat.
    const known = new Set(state.notifications.map((n) => n.id));
    const fresh = page.filter((n) => !known.has(n.id));
    state.notifications = state.notifications.concat(fresh).sort((a, b) => notifTime(b) - notifTime(a));
    notifPaging.beyond = Math.max(0, notifPaging.beyond - fresh.filter((n) => !n.readAt).length);
    notifPaging.cursor[filter] = oldestNotif(page) || before;
    notifPaging.more[filter] = page.length >= NOTIF_PAGE && fresh.length > 0;
  } catch (err) {
    toastError(err, 'Could not load older notifications.');
  }
  notifPaging.loading = false;
  repaintOverlays();
}

/* Read at once, then told to the server; a failure puts it all back. */
async function markAllNotificationsRead() {
  // On failure only these ids go back to unread: a card pushed (or an older page
  // loaded) while the POST was out must survive the rollback.
  const wereUnread = new Set(state.notifications.filter((n) => !n.readAt).map((n) => n.id));
  const prevBeyond = notifPaging.beyond;
  const now = new Date().toISOString();
  state.notifications = state.notifications.map((n) => (n.readAt ? n : { ...n, readAt: now }));
  notifPaging.beyond = 0;
  repaintOverlays();
  try {
    await api('/api/notifications/mark-all-read', { method: 'POST' });
  } catch (err) {
    state.notifications = state.notifications.map((n) =>
      wereUnread.has(n.id) && n.readAt === now ? { ...n, readAt: null } : n
    );
    notifPaging.beyond = prevBeyond;
    repaintOverlays();
    toastError(err, 'Could not mark them read.');
  }
}

/* Read cards go; unread ones stay. Server-wide for the user, not just the loaded pages. */
async function clearReadNotifications() {
  // On failure the removed cards are put back, in their place, beside anything
  // that arrived meanwhile — never a snapshot over it.
  const removed = state.notifications.filter((n) => n.readAt);
  state.notifications = state.notifications.filter((n) => !n.readAt);
  repaintOverlays();
  try {
    await api('/api/notifications/read', { method: 'DELETE' });
  } catch (err) {
    const have = new Set(state.notifications.map((n) => n.id));
    state.notifications = [...state.notifications, ...removed.filter((n) => !have.has(n.id))].sort(
      (a, b) => notifTime(b) - notifTime(a)
    );
    repaintOverlays();
    toastError(err, 'Could not clear read notifications.');
  }
}

function unreadNotifs() {
  return state.notifications.filter((n) => !n.readAt).length + (notifPaging.beyond || 0);
}

async function refreshNotifications() {
  try {
    const [list, unread] = await Promise.all([
      api(notifPageUrl('all')),
      api('/api/notifications/unread-count').catch(() => null),
    ]);
    setNotifFirstPage(list);
    const loaded = state.notifications.filter((n) => !n.readAt).length;
    notifPaging.beyond = Math.max(0, ((unread && unread.count) || 0) - loaded);
    repaintOverlays();
  } catch (_) {
    /* silent */
  }
}

/* Read at once, then told to the server; a failure puts the dot back and says
   so. The tap used to wait out the PATCH and fail with a console line only.
   An already-read row (or one in flight) sends nothing. */
async function markNotificationRead(id) {
  const prev = state.notifications.find((n) => n.id === id);
  if (!prev || prev.readAt) return;
  const setRead = (readAt) => {
    state.notifications = state.notifications.map((n) => (n.id === id ? { ...n, readAt } : n));
    repaintOverlays();
  };
  setRead(new Date().toISOString());
  try {
    await api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH' });
  } catch (err) {
    setRead(null);
    toastError(err, 'Could not mark that as read.');
  }
}

/* ---- Buddy (mentor.js) wiring ----
   The open thread lives in memory only: leaving Buddy and coming back opens the
   same chat, a reload opens the newest. mentorStarter is text the next Buddy
   mount prefills — set by a tap on the evening-reflection card. */
let mentorThreadId = null;
let mentorStarter = '';

/** Taken once by the Buddy screen. Also covers the reflection's push, which only
    opens /#mentor: an unread reflection card from the last 3 hours is the starter. */
function takeMentorStarter() {
  if (mentorStarter) {
    const s = mentorStarter;
    mentorStarter = '';
    return s;
  }
  const n = (state.notifications || []).find(
    (x) =>
      x.kind === 'buddy_checkin' &&
      !x.readAt &&
      Date.now() - new Date(x.createdAt).getTime() < 3 * 3600 * 1000
  );
  if (!n) return '';
  // Not inside render(): marking read repaints the overlays.
  setTimeout(() => markNotificationRead(n.id), 0);
  return n.body || '';
}

/** The bell's evening-reflection card: open Buddy with its question in the box. */
function openReflectionCard(n) {
  mentorStarter = n.body || '';
  markNotificationRead(n.id);
  state.notifOpen = false;
  setScreen('mentor', { force: true });
}

/** Settings › Alerts' "Evening reflection" value, for Buddy's chat sheet. */
function reflectionLabel() {
  const t = state.user && state.user.uiPrefs && state.user.uiPrefs.buddyReflection;
  return t ? formatTime(t) : 'Off';
}

function mentorApi() {
  const T = (id) => '/api/mentor/threads/' + encodeURIComponent(id);
  return {
    get: (id) =>
      id
        ? api(T(id) + '/messages').then(
            (messages) => ({ threadId: id, messages }),
            (err) => {
              // Deleted on another device: open the newest instead.
              if (err && err.status === 404) {
                mentorThreadId = null;
                return api('/api/mentor/chat');
              }
              throw err;
            }
          )
        : api('/api/mentor/chat'),
    post: (text, id) =>
      api(T(id) + '/messages', { method: 'POST', body: JSON.stringify({ content: text }) }),
    stream: (text, signal, id) => apiStream(T(id) + '/messages/stream', { content: text }, signal),
    clear: (id) => api(T(id) + '/messages', { method: 'DELETE' }),
    threads: {
      list: () => api('/api/mentor/threads'),
      create: () => api('/api/mentor/threads', { method: 'POST', body: '{}' }),
      rename: (id, title) => api(T(id), { method: 'PATCH', body: JSON.stringify({ title }) }),
      remove: (id) => api(T(id), { method: 'DELETE' }),
    },
    onThread: (id) => {
      mentorThreadId = id;
    },
    today: todayKey,
    reflection: { label: reflectionLabel, open: () => openProfileSettings('notifications') },
    // Buddy's one-tap actions, after the user confirmed the sheet. Each throws to
    // keep the sheet open with the reason.
    // A task or habit chip saves on the tap; the toast's Undo deletes what it made
    // at once (unmake), found by id against the list before, so createTask/createHabit
    // stay as they are.
    act: {
      task: async (title) => {
        const made = await createTask({ title });
        if (!made || made.queued) return; // queued: "saved on this phone" was said
        pushToast('Task added.', 'success', 6000, {
          label: 'Undo',
          run: () => unmake(() => state.tasks, (l) => (state.tasks = l), made.id, () => sendTaskDelete(made.id)),
        });
      },
      habit: async ({ title, time }) => {
        const had = new Set(state.habits.map((x) => x.id));
        await createHabit({
          name: title,
          domain: 'habit',
          icon: 'repeat',
          cadence: 'daily',
          metric: 'none',
          reminderTime: time || null,
        });
        const made = state.habits.find((x) => !had.has(x.id));
        if (!made) return toastSuccess('Habit added.');
        pushToast('Habit added.', 'success', 6000, {
          label: 'Undo',
          run: () => unmake(() => state.habits, (l) => (state.habits = l), made.id, () => sendHabitDelete(made.id)),
        });
      },
      reminder: async ({ title, date, time, timeInput }) => {
        if (time && isPastSlot(date, time)) {
          throw fieldRefusal(timeInput, 'That time has already passed — pick a later one.');
        }
        const created = await api('/api/reminders', {
          method: 'POST',
          body: JSON.stringify({ text: title, date, time: time || null, tag: 'personal', repeat: 'none' }),
        });
        state.reminders.push(created);
        reSyncDeviceAlarms();
        toastSuccess('Reminder added.');
      },
    },
  };
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
    repaintOverlays(); // the bell only: rebuilding the screen behind it reset whatever it held
    // An open Circle screen moves the row from "Requests for you" to Connections.
    window.dispatchEvent(new CustomEvent('gb:circle-changed'));
    // Re-fetch in case the server-side delete also created new rows.
    await refreshNotifications();
  } catch (err) {
    toastError(err, 'Could not respond to invite.');
  }
}

/* The bell, avatar and More panels are one entry on the shared back stack
   (gb-kit trackOverlay): hardware Back or the browser's closes the open one
   before it leaves the screen, and on Home before it minimises the app.
   Synced from installOutsideClickToCloseHeaderPopovers, which every path that
   opens or shuts a panel goes through (setScreen and logout via render()). */
let untrackPanels = null;
function syncPanelBackEntry() {
  const open = state.notifOpen || state.profileOpen || state.moreOpen;
  if (open && !untrackPanels) untrackPanels = trackOverlay({ close: closeHeaderPanels });
  else if (!open && untrackPanels) {
    untrackPanels();
    untrackPanels = null;
  }
}
function closeHeaderPanels() {
  const wasOpen = state.notifOpen || state.profileOpen || state.moreOpen;
  state.notifOpen = false;
  state.profileOpen = false;
  state.moreOpen = false;
  syncPanelBackEntry();
  // setScreen has already shut them and renders next; only Back needs a repaint.
  if (wasOpen) repaintOverlays();
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
  // The server's level curve, not a local constant (this said 500 against its 100).
  const xpProgress = Math.min(100, levelProgress(u).pct);
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
    outboxChip(),
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
          repaintOverlays();
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
  // A screen may carry a query (#/circle?join=CODE, a circle invite link): the
  // screen reads it, the route is the part before it.
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0].toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SCREENS, raw)) return raw;
  // An unknown address (#/settings: Settings is a dialog, not a screen) shows
  // Home, so the bar says so too instead of keeping the address that isn't there.
  if (raw) history.replaceState(null, '', '#/home');
  return 'home';
}

/* Where a signed-out visitor was headed: the #/money link they opened, or the
   screen their session expired on. Memory only, taken once by the next
   sign-in; every sign-in used to land on Home. */
let returnToScreen = '';

/* A manifest shortcut (?shortcut=water) or a share into the app (?text=…):
   read once, taken off the address at once so a reload doesn't log a second
   glass, and run after the first data load (runLaunchIntent). Signed out, it
   waits for the sign-in's first load. */
let pendingLaunch = launchIntent(window.location.search);
if (pendingLaunch) history.replaceState(null, '', window.location.pathname + window.location.hash);

function runLaunchIntent() {
  const it = pendingLaunch;
  pendingLaunch = null;
  if (!it) return;
  if (it.share) {
    // The shared words go through Quick add's own preview; nothing is written
    // until the user ticks and confirms there.
    openAddSheet({ text: it.share, preview: true });
    return;
  }
  if (it.shortcut === 'water' && featureOn('water')) {
    const before = ((state.water && state.water.entries) || []).length;
    quickAddWater(WATER_ACTION_ML).then(() => {
      // Failures and offline saves have toasted already.
      const now = ((state.water && state.water.entries) || []).length;
      if (now > before && navigator.onLine) toastSuccess('Logged ' + WATER_ACTION_ML + ' ml of water.');
    });
  } else if (it.shortcut === 'task') {
    openAddTask();
  } else if (it.shortcut === 'focus' && screenEnabled('focus')) {
    focusAutoStart = true;
    setScreen('focus');
  } else if (it.shortcut === 'quickadd') {
    openAddSheet();
  }
}

function landAfterSignIn() {
  const target = Object.prototype.hasOwnProperty.call(SCREENS, returnToScreen)
    ? returnToScreen
    : 'home';
  returnToScreen = '';
  state.screen = target;
  // An invite link opened while signed out keeps its query through sign-in.
  const query = screenFromHash() === target ? (window.location.hash.split('?')[1] || '') : '';
  history.replaceState(null, '', '#/' + target + (query ? '?' + query : ''));
}

function setScreen(id, opts) {
  opts = opts || {};
  // Tapping a "More" item that's already active should still close the sheet.
  if (state.screen === id && !opts.force) {
    if (state.moreOpen) {
      state.moreOpen = false;
      repaintOverlays();
    } else if (opts.tab) {
      // The tab you're on, tapped again: back to the top, the way a phone's tab
      // bar does. Each screen still keeps its spot when you switch away and back.
      const main = document.getElementById('gb-main');
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (main) main.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    }
    return;
  }
  state.screen = id;
  state.notifOpen = false;
  state.profileOpen = false;
  state.moreOpen = false;
  // Same reasoning as the three panels above, for dialogs: a sheet belongs to
  // the screen that opened it. Safe here because the early return above means
  // this only runs on a real screen change, never a same-screen repaint.
  closeOverlays();
  if (!opts.keepToasts) clearScreenToasts();
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
  if (!state.user) {
    returnToScreen = screenFromHash();
    return;
  }
  // A link with a query (#/circle?join=CODE) on the screen already showing:
  // force the repaint, or the screen that reads the query never sees it.
  setScreen(screenFromHash(), { fromHash: true, force: window.location.hash.includes('?') });
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
  // And on at least 3 of the 7 days: one tick on signup day made "your week"
  // out of a few minutes. A 3-day streak proves it too (trends are per device).
  const s = weeklyReviewStats();
  return s.loggedDays >= 3 || s.topStreak >= 3;
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
  const spentOn = new Set(((state.money && state.money.expenses) || []).map((e) => e.date));
  // Days with something the review shows: a score, a mood, an expense.
  const loggedDays = days.filter((k) => Number(byDate[k] && byDate[k].score) > 0 || moodByDate[k] || spentOn.has(k)).length;
  return { avgScore, activeDays, spend, topStreak, moodLogs, loggedDays };
}

function openWeeklyReview() {
  const { sheet, close } = openOverlay({ label: 'Weekly review' });
  const s = weeklyReviewStats();
  const prev = loadWeekly()[weekStartKey(new Date())] || {};

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
  // No review yet: draft the wins from the week (review.js), so the user edits
  // rather than writes. Lands only while the box is still untouched.
  if (!prev.wins) {
    let typed = false;
    wins.addEventListener('input', () => (typed = true), { once: true });
    Promise.all([import('./review.js'), api('/api/tasks/finished?days=7').catch(() => [])])
      .then(([review, finished]) => {
        const draft = review.weeklyWinsDraft({
          finished,
          habits: state.habits,
          trends: state.trends,
          money: state.money,
          today: todayKey(),
          fmtMoney: (n) => fmtIn(Math.round(n), homeCur(state.money)),
        });
        if (draft && !typed && !wins.value) wins.value = draft.slice(0, 400);
      })
      .catch(() => {});
  }
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

  sheet.append(
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
      tile(fmtIn(s.spend, homeCur(state.money)), 'spent'),
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
  refreshIcons();
  focusSoon(focus);
}

function notifyMuted(cat) {
  const m = state.user && state.user.uiPrefs && state.user.uiPrefs.notifyMute;
  return !!(m && m[cat]);
}

/* ---- Habit dialogs ----
   The form, history panel and freeze calendar live in scripts/habit-dialogs.js,
   a lazy chunk (precached like every chunk). */
function habitDialogs() {
  return import('./habit-dialogs.js').then((m) => {
    m.bind({
      state, announce, pushToast, toastError, toastSuccess, todayKey, reconcileStreakFreeze,
      isQuitHabit, freezeTokensLeft, api, habitNoteInput, refreshScoreLater, createHabit,
      updateHabit, forgetGoalHabitHistory, deleteHabit, reSyncDeviceAlarms, openModal, segmented,
      METRIC_LABEL, accountTodayKey, metricSummary, render,
    });
    return m;
  });
}
function openHabitForm(habit) {
  habitDialogs()
    .then((m) => m.openHabitForm(habit))
    .catch((err) => reloadIfStaleChunk(err) || toastError(err, 'Could not open the habit form.'));
}
function openFreezeCalendar() {
  habitDialogs()
    .then((m) => m.openFreezeCalendar())
    .catch((err) => reloadIfStaleChunk(err) || toastError(err, 'Could not open the freeze calendar.'));
}

/* ---- Settings ----
   The sheet and its panes live in scripts/settings.js, a lazy chunk (precached
   like every chunk): this is all of it the boot chunk carries. */
let settingsModule = null;
function openProfileSettings(initialTab) {
  import('./settings.js')
    .then((m) => {
      settingsModule = m;
      m.openSettings(settingsContext(), initialTab);
    })
    .catch((err) => reloadIfStaleChunk(err) || toastError(err, 'Could not open Settings.'));
}
/* What settings.js uses from here, by the same names. */
function settingsContext() {
  return {
    PREMIUM_KEY, loadPremiumCss, applyPremium, TEXT_SCALE_KEY, applyTextScale, state, pushToast,
    toastError, toastSuccess, loadToken, saveSession, cacheMoney, rememberMoneyVersion,
    adoptServerMoney, persistMoney, saveMoney, saveUiPrefs, notifySound, readCustomChimes, storeCustomChimes,
    newSoundId, todayKey, syncUserSession, enablePushFlow, api, withPendingWater, invalidateWeek,
    pickedTheme, setThemeChoice, notifyMuted, keyOfDate, shortDay, reminderQuickAdd, uploadNewCustomSound,
    openIcsImportDialog, snoozeMinutes, cancelReminderSnooze, waterReminderPrefs,
    reSyncDeviceAlarms, deleteReminder, openModal, segmented, relativeTime, FEATURE_DEFS, featureOn,
    featureSwitchRow, lazyScreen, repaintOverlays, privacyLink, otpBoxes, logout, endSession, render,
    breakPrefs, breakUntilLabel, takeBreak, endBreakNow,
  };
}

/** Repaint the Settings list if it is on screen; a no-op otherwise. */
function repaintReminderSettings() {
  if (settingsModule) settingsModule.repaintReminderSettings();
}

function keyOfDate(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function shortDay(key) {
  const today = todayKey();
  const d = new Date(key + 'T00:00:00');
  const tomorrow = keyOfDate(new Date(Date.now() + 864e5));
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* The compact reminder add (text, notify, day, time, repeat, mic): Settings ›
   Reminders shows it inline, and + then Reminder opens it as a sheet
   (openReminderSheet). Enter adds; with no time picked the text is read for
   one first. onAdded(created) runs after a save; without it the form clears
   for the next one. */
function reminderQuickAdd(onAdded) {
  const textInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'What should I remind you of?',
    maxlength: 255,
    'aria-label': 'Reminder text',
  });
  const dateInput = h('input', {
    type: 'date',
    class: 'gb-input',
    value: todayKey(),
    min: todayKey(),
    'aria-label': 'Reminder date',
  });
  const timeInput = h('input', {
    type: 'time',
    class: 'gb-input gb-input--time',
    'aria-label': 'Reminder time',
  });
  const usualTime = UsualTimeChip(timeInput);
  usualTime.sync(state.reminders);
  const repeatSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Repeat' },
    REPEAT_ORDER.map((r) => h('option', { value: r }, r === 'none' ? 'Once' : REPEATS[r].label))
  );
  // The calendar's own Notify control, Custom… included.
  const notifySel = NotifySelect();
  const addErr = h('p', { class: 'gb-field-error', role: 'alert', style: { display: 'none' } });
  const setErr = (msg) => {
    addErr.textContent = msg || '';
    addErr.style.display = msg ? '' : 'none';
  };
  textInput.addEventListener('input', () => setErr(''));

  const addBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary gb-remset-add-btn' },
    Icon('plus', { size: 16, sw: 2.6, color: 'var(--fg-on-brand)' }),
    'Add reminder'
  );
  const submit = async () => {
    const text = textInput.value.trim();
    if (!text) {
      setErr('Write what to be reminded of first.');
      textInput.focus();
      return;
    }
    if (!dateInput.value) {
      setErr('Pick a day for it.');
      dateInput.focus();
      return;
    }
    addBtn.disabled = true;
    try {
      // No time picked: the words may carry one ("call mom at 6"). The same
      // reader as Quick add; offline or unread, it saves as typed.
      if (!timeInput.value) {
        // Read as a reminder, not as whatever else the words could be ("buy milk at 6" is a task).
        const said = /^(remind|set a reminder|reminder)\b/i.test(text) ? text : 'remind me to ' + text;
        const rem = await parseQuickAdd(said)
          .then((r) => (r.intents || []).find((x) => x.type === 'reminder' && x.time))
          .catch(() => null);
        if (rem) {
          if (rem.text) textInput.value = rem.text;
          if (rem.date) dateInput.value = rem.date;
          timeInput.value = hhmm(rem.time);
          if (REPEATS[rem.repeat]) repeatSel.value = rem.repeat;
          if (rem.notifyBefore !== undefined) notifySel.setLead(rem.notifyBefore);
          if (!spokenTag && TAGS[rem.tag]) spokenTag = rem.tag;
        }
      }
      const created = await addReminder(
        dateInput.value,
        textInput.value.trim() || text,
        timeInput.value || '',
        spokenTag || 'personal',
        repeatSel.value,
        '',
        '',
        '',
        notifySel.getLead()
      );
      if (created) {
        spokenTag = null;
        voiceNote.style.display = 'none';
        textInput.value = '';
        timeInput.value = '';
        usualTime.sync(state.reminders);
        repeatSel.value = 'none';
        notifySel.setLead(null);
        if (onAdded) onAdded(created);
        else textInput.focus();
      }
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.onclick = submit;
  // Enter adds rather than reaching the sheet, where it would press Done.
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  });

  // The calendar form's mic, here too: say it, check it, Add. This form has
  // no Tag field, so a spoken tag ("urgent", "for work") rides along to the save.
  let spokenTag = null;
  const voiceNote = h('p', { class: 'gb-field-hint gb-voice-note', role: 'status', style: { display: 'none' } });
  const micBtn = voiceSupported()
    ? h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--compact gb-mic gb-rem-mic',
          'aria-label': 'Say the reminder',
          'aria-pressed': 'false',
          onclick: async () => {
            voiceNote.style.display = 'none';
            const out = await captureReminder(micBtn);
            if (!out || !out.said) return;
            setErr('');
            const rem = out.reminder;
            textInput.value = rem ? rem.text || out.said : out.said;
            spokenTag = rem && TAGS[rem.tag] ? rem.tag : null;
            if (rem) {
              if (rem.date) dateInput.value = rem.date;
              timeInput.value = hhmm(rem.time);
              repeatSel.value = REPEATS[rem.repeat] ? rem.repeat : 'none';
              notifySel.setLead(rem.notifyBefore === undefined ? null : rem.notifyBefore);
            }
            voiceNote.textContent = rem
              ? 'Filled in from what you said: ' + reminderSummary(rem) + '. Check it, then tap Add.'
              : 'Heard: “' + out.said + '”. Set the day and time, then tap Add.';
            voiceNote.style.display = '';
            textInput.focus();
          },
        },
        Icon('mic', { size: 18 })
      )
    : null;
  textInput.addEventListener('input', () => {
    voiceNote.style.display = 'none';
  });

  const addForm = h(
    'div',
    { class: 'gb-remset-add' },
    micBtn ? h('div', { class: 'gb-rem-text-row' }, textInput, micBtn) : textInput,
    addErr,
    voiceNote,
    h(
      'div',
      { class: 'gb-remset-add-grid' },
      // Notify spans the row: its Custom… line needs the width.
      h('div', { class: 'gb-remset-field gb-remset-field--wide' }, h('span', null, 'Notify'), notifySel),
      h('label', { class: 'gb-remset-field' }, h('span', null, 'Day'), dateInput),
      h('label', { class: 'gb-remset-field' }, h('span', null, 'Time'), timeInput),
      h('label', { class: 'gb-remset-field gb-remset-field--wide' }, h('span', null, 'Repeat'), repeatSel)
    ),
    usualTime.node,
    addBtn
  );
  return { node: addForm, focus: () => textInput.focus() };
}

/* + then Reminder: the quick add above as a sheet over wherever the user is,
   text focused, so "call mom at 6" then Enter is the whole flow. */
function openReminderSheet() {
  const { sheet, close } = openOverlay({ label: 'New reminder' });
  const form = reminderQuickAdd(close);
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'New reminder'),
      h('div', { class: 'gb-modal-sub' }, 'Today unless you pick a day. A time in the words is read for you.')
    ),
    form.node,
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Cancel')
  );
  refreshIcons();
  setTimeout(form.focus, 60);
}

/* The account's copy of a sound just kept on this device. 'saved', 'local'
   (unreachable — it plays here and goes up at the next sign-in) or 'refused':
   a 4xx, say another device took the last slot, which drops the local copy
   too, or it would retry and fail at every sign-in. The caller repaints. */
async function uploadNewCustomSound(sound) {
  try {
    await uploadCustomChime(sound);
    return 'saved';
  } catch (err) {
    if (err && err.status >= 400 && err.status < 500) {
      storeCustomChimes(readCustomChimes().filter((s) => s.id !== sound.id));
      if (notifySound() === customKey(sound.id)) saveUiPrefs({ notifySound: DEFAULT_CHIME });
      reSyncDeviceAlarms();
      toastError(err, 'Couldn’t save that sound.');
      return 'refused';
    }
    return 'local';
  }
}

/* "+ Add your own sound…" in a reminder's or habit's Tone list: the same file or
   voice recording as Settings → Alerts, under the same cap (CUSTOM_MAX_COUNT,
   enforced again by the server). Resolves to the new key — the picker selects
   it for that reminder only, the default tone is left alone — or null. */
function openCustomToneDialog() {
  return new Promise((resolve) => {
    let result = null;
    let recording = null;
    const { sheet, close } = openOverlay({
      label: 'Add your own sound',
      className: 'gb-tone-modal',
      onClose: () => {
        if (recording) recording.cancel();
        resolve(result);
      },
    });
    const have = customChimes();
    const full = have.length >= CUSTOM_MAX_COUNT;
    const head = h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, full ? 'Your sounds are full' : 'Add your own sound'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        full
          ? 'You can keep ' +
              CUSTOM_MAX_COUNT +
              ' of your own, and all ' +
              CUSTOM_MAX_COUNT +
              ' are taken. Remove one in Settings → Alerts to add another, or pick one of these.'
          : 'A file under ' +
              Math.round(CUSTOM_MAX_BYTES / 1024) +
              ' KB, or up to ' +
              CUSTOM_MAX_MS / 1000 +
              ' seconds of your voice. It joins your sounds (' +
              have.length +
              ' of ' +
              CUSTOM_MAX_COUNT +
              ') for any reminder or habit.'
      )
    );
    const cancelBtn = h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    );

    if (full) {
      sheet.append(
        head,
        h(
          'div',
          { class: 'gb-tone-have' },
          // Each one picks itself for this reminder: what "pick one of these" offers.
          have.map((c) =>
            h(
              'button',
              {
                type: 'button',
                class: 'gb-tone-chip',
                'aria-label': 'Use ' + c.name,
                onclick: () => {
                  result = c.key;
                  playChime(c.key);
                  close();
                },
              },
              Icon(c.source === 'recording' ? 'mic' : 'audio-lines', { size: 13 }),
              c.name
            )
          )
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            style: { width: '100%', marginTop: '14px' },
            onclick: () => {
              close();
              openProfileSettings('notifications');
            },
          },
          'Manage sounds in Settings'
        ),
        cancelBtn
      );
      refreshIcons();
      return;
    }

    const keep = async (name, dataUrl, source) => {
      const sound = { id: newSoundId(), name, source, dataUrl, updatedAt: new Date().toISOString(), synced: false };
      storeCustomChimes(readCustomChimes().concat(sound));
      const key = customKey(sound.id);
      playChime(key);
      const outcome = await uploadNewCustomSound(sound);
      if (outcome === 'refused') {
        close();
        return;
      }
      result = key;
      toastSuccess(
        outcome === 'saved'
          ? 'Added “' + name + '”. It’s this reminder’s tone now.'
          : 'Added “' + name + '” on this device; your others get it when you’re next online.'
      );
      close();
    };

    const file = h('input', {
      type: 'file',
      accept: 'audio/*',
      style: { display: 'none' },
      onchange: async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        let dataUrl;
        try {
          dataUrl = await readCustomChime(f);
        } catch (err) {
          pushToast(err.message || 'Could not use that file.', 'error', 4200);
          return;
        }
        const name =
          (f.name || '')
            .replace(/\.[^.]+$/, '')
            .trim()
            .slice(0, 40) || 'Your sound';
        keep(name, dataUrl, 'file');
      },
    });

    const recBar = h('span', { class: 'gb-sound-rec-fill' });
    const recTime = h('span', { class: 'gb-sound-rec-time' }, '0:00');
    const recPanel = h(
      'div',
      { class: 'gb-sound-rec', role: 'status', 'aria-live': 'polite', style: { display: 'none' } },
      h(
        'div',
        { class: 'gb-sound-rec-head' },
        h('span', { class: 'gb-sound-rec-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'gb-sound-rec-label' }, 'Recording…'),
        recTime
      ),
      h('div', { class: 'gb-sound-rec-track', 'aria-hidden': 'true' }, recBar),
      h(
        'div',
        { class: 'gb-sound-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary gb-btn--compact',
            onclick: () => recording && recording.stop(),
          },
          'Stop & save'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost gb-btn--compact',
            onclick: () => recording && recording.cancel(),
          },
          'Cancel'
        )
      )
    );
    const recordBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-modal-opt',
        onclick: async () => {
          if (recording) return;
          recordBtn.disabled = true;
          try {
            recording = await recordCustomChime();
          } catch (err) {
            recordBtn.disabled = false;
            pushToast(err.message || 'Couldn’t start recording.', 'error', 4600);
            return;
          }
          recordBtn.disabled = false;
          choices.style.display = 'none';
          recPanel.style.display = '';
          const started = Date.now();
          const tick = () => {
            const ms = Math.min(CUSTOM_MAX_MS, Date.now() - started);
            recTime.textContent = '0:0' + Math.floor(ms / 1000) + ' / 0:0' + CUSTOM_MAX_MS / 1000;
            recBar.style.width = (ms / CUSTOM_MAX_MS) * 100 + '%';
          };
          tick();
          const timer = setInterval(tick, 100);
          let dataUrl = null;
          try {
            dataUrl = await recording.done;
          } catch (err) {
            pushToast(err.message || 'Couldn’t save that recording.', 'error', 4600);
          }
          clearInterval(timer);
          recording = null;
          recPanel.style.display = 'none';
          choices.style.display = '';
          if (dataUrl) {
            const used = new Set(customChimes().map((c) => c.name));
            let n = 1;
            while (used.has('Recording ' + n)) n++;
            keep('Recording ' + n, dataUrl, 'recording');
          }
        },
      },
      h('span', { class: 'gb-modal-opt-ic' }, Icon('mic', { size: 20 })),
      h(
        'span',
        { class: 'gb-modal-opt-tx' },
        h('span', { class: 'gb-modal-opt-l' }, 'Record your voice'),
        h('span', { class: 'gb-modal-opt-s' }, 'Up to ' + CUSTOM_MAX_MS / 1000 + ' seconds')
      )
    );
    const fileBtn = h(
      'button',
      { type: 'button', class: 'gb-modal-opt', onclick: () => file.click() },
      h('span', { class: 'gb-modal-opt-ic' }, Icon('audio-lines', { size: 20 })),
      h(
        'span',
        { class: 'gb-modal-opt-tx' },
        h('span', { class: 'gb-modal-opt-l' }, 'Pick a sound file'),
        h('span', { class: 'gb-modal-opt-s' }, 'mp3, m4a, ogg or wav, under ' + Math.round(CUSTOM_MAX_BYTES / 1024) + ' KB')
      )
    );
    const choices = h('div', { class: 'gb-modal-opts gb-tone-choices' }, canRecordChime() ? recordBtn : null, fileBtn, file);
    sheet.append(head, choices, recPanel, cancelBtn);
    refreshIcons();
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
  calGoTo(new Date());
}

/* Any day, not just today — a task's due day. Its own function because
   calToday is handed out as an onclick, which would pass it the event. */
function calGoTo(t) {
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

/* Returns the new reminder, or null when it was refused or failed (and toasted). */
/* `extra`: the optional rest of CreateReminderRequest: notes, notifyBefore2 and
   the richer rule (repeatInterval, repeatDays, repeatNth, repeatCount). */
async function addReminder(key, text, time, tag, repeat, until, sound, endTime, notifyBefore, extra) {
  if (!text || addingReminder) return null;
  // A day that has already gone takes no reminders at all — the calendar hides
  // the form on past days, and this is the same rule for every other caller.
  // The anchor date is what a recurrence counts from, so an anchor in the past
  // is a series the user never got to choose the start of.
  if (key < todayKey()) {
    toastError(
      new Error('That day has already passed — pick today or later.'),
      'Could not add reminder.'
    );
    return null;
  }
  // Today, but at an hour that has gone. A recurring one still fires — "daily at
  // 8am" set up at 10am has tomorrow — so only the single occurrence is refused.
  if ((repeat || 'none') === 'none' && isPastSlot(key, time)) {
    toastError(
      new Error('That time has already passed — pick a later one.'),
      'Could not add reminder.'
    );
    return null;
  }
  addingReminder = true;
  try {
    const body = {
      text: text,
      date: key,
      time: time || null,
      endTime: endTime || null,
      tag: tag || 'personal',
      repeat: repeat || 'none',
      until: until || null,
      // Empty means "use my default tone", and the server stores that as null.
      sound: sound || null,
      // null = follow the default in Settings → Reminders.
      notifyBefore: notifyBefore === null || notifyBefore === undefined || notifyBefore === '' ? null : Number(notifyBefore),
      ...(extra || {}),
    };
    let created;
    let queued = false;
    const idemKey = newIdemKey(); // this tap, live or replayed
    const post = () =>
      api('/api/reminders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: JSON.stringify(body),
      });
    // A one-off offline goes in under a temp id and still rings on this phone
    // (device alarm ids don't come from the reminder's). A series waits for
    // the server: its skips and splits are the server's to work out.
    const local = { ...body, id: tempId() };
    try {
      created =
        body.repeat === 'none'
          ? await sendAhead(
              { method: 'POST', path: '/api/reminders', body, kind: 'reminder.create', tempId: local.id, local, idemKey },
              post
            )
          : await post();
    } catch (err) {
      if (!err.queued) throw err;
      created = local;
      queued = true;
    }
    state.reminders.push(created);
    reSyncDeviceAlarms();
    askPushOnce(!!body.time);
    resetCalendarForm();
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      // Repaint the month grid's dot indicators for the affected day.
      repaintCalendarGrid();
    } else {
      render();
    }
    // Queued: sendAhead has already said it is saved on this phone.
    if (!queued) toastSuccess('Reminder added.');
    repaintReminderSettings();
    return created;
  } catch (err) {
    toastError(err, 'Could not add reminder.');
    return null;
  } finally {
    addingReminder = false;
  }
}

/* What timer.js is handed, both by the Focus screen and by the boot-time
   resumeFocusSession (a session that ended while the app was closed is counted
   then). chimeKey: the session end rings the user's own alert tone. */
function focusProps() {
  const link = focusPreselect;
  focusPreselect = null; // taken once: the next visit opens on whatever the timer holds
  const autoStart = focusAutoStart;
  focusAutoStart = null;
  return {
    // link: { taskId } | { goalId } | null — what the session was spent on.
    onFocusSession: (mode, durationSec, link) => {
      // A task made offline: its server id once the create has landed, else no
      // link at all. A `tmp-` id fails the UUID binding (400) and lost the minutes.
      const id = (v) => (v && !isTempId(realId(v)) ? realId(v) : null);
      const saved = api('/api/focus/sessions', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          durationSec,
          taskId: id(link && link.taskId),
          goalId: id(link && link.goalId),
        }),
      });
      // A finished focus session may be what a "Deep work 2h" habit was waiting for.
      if (mode === 'focus') saved.then(autoTickFocusHabits, () => {});
      return saved;
    },
    getFocusStats: () => api('/api/focus/stats'),
    getFocusHistory: () => api('/api/focus/history?days=30'),
    statsOwner: state.user && state.user.id,
    chimeKey: notifySound(),
    // "Focusing on…": the open tasks and goals, and a "Start focus" row's pick.
    focusTargets: {
      tasks: (state.tasks || []).filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, paused: t.paused })),
      goals: (state.goals || [])
        .flatMap((sec) => sec.goals || [])
        .filter((g) => !g.completed)
        .map((g) => ({ id: g.id, title: g.title })),
    },
    preselect: link,
    autoStart,
    // Daily focus goal, minutes (0 = off). In ui_prefs, where FocusService reads it for the streak.
    focusGoalMins: (state.user && state.user.uiPrefs && state.user.uiPrefs.focusGoalMins) || 0,
    onSetFocusGoal: (mins) => saveUiPrefs({ focusGoalMins: mins }),
    // The end-of-sprint "Mark done": never flips back a task ticked meanwhile.
    onFinishTask: (id) => {
      if ((state.tasks || []).some((t) => t.id === id && !t.done)) toggleTask(id);
    },
  };
}

/* A task or goal row's "Start focus": open the timer with it picked. A task
   row's timer button means "work on this now", so it also starts the clock
   (`run`); ScreenFocus never restarts a session already running. */
let focusPreselect = null;
let focusAutoStart = null; // minutes, or true for the last length: Quick add's "start a focus"
function startFocusOn(link, run) {
  focusPreselect = link;
  if (run) focusAutoStart = true;
  if (state.screen === 'focus') render();
  else setScreen('focus');
}

/* ---- Snooze ----
   One snoozed_until per reminder on the server; the scheduler rings it then on
   every channel the reminder itself uses (bell, WhatsApp, push), and this
   device's own alarm queue picks it up from the reminder (push.js). */
/* A single-reminder answer (edit, snooze) carries doneDates: null; only the
   list has them. Keep the ones this device already holds. */
function keepDone(old, saved) {
  return saved && !Array.isArray(saved.doneDates)
    ? Object.assign({}, saved, { doneDates: (old && old.doneDates) || [] })
    : saved;
}

/* Check one occurrence off, or back on. Optimistic: the row and the device's
   alarm queue change at once and go back if the server refuses. Checking off
   also drops a pending snooze, as the server does. */
async function toggleReminderDone(id, key, done) {
  const rem = (state.reminders || []).find((r) => r.id === id);
  if (!rem) return;
  if (isTempId(realId(id))) return void toastError(null, STILL_SYNCING);
  const before = { doneDates: rem.doneDates, snoozedUntil: rem.snoozedUntil };
  const dates = (rem.doneDates || []).filter((d) => d !== key);
  rem.doneDates = done ? dates.concat(key) : dates;
  if (done) rem.snoozedUntil = null;
  const repaint = () => {
    reSyncDeviceAlarms();
    rerenderCalendarSideIfActive();
    repaintReminderSettings();
  };
  repaint();
  try {
    await api(
      '/api/reminders/' + encodeURIComponent(realId(id)) + '/done?date=' + encodeURIComponent(key),
      { method: done ? 'POST' : 'DELETE' }
    );
  } catch (err) {
    Object.assign(rem, before);
    repaint();
    toastError(err, done ? 'Could not mark that done.' : 'Could not undo that.');
  }
}

/* Google / Apple / Outlook events in as reminders (import-ui.js, loaded on tap).
   Times land in the account's zone, the one the scheduler rings them in. */
function openIcsImportDialog() {
  const zone = (state.user && state.user.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  import('./import-ui.js')
    .then((m) =>
      m.openIcsImport({
        api,
        existing: state.reminders,
        zone,
        today: accountTodayKey,
        now: accountNowHHMM,
        onDone: async () => {
          state.reminders = await api('/api/reminders');
          reSyncDeviceAlarms();
          repaintReminderSettings();
          if (state.screen === 'calendar') {
            rerenderCalendarSideIfActive();
            repaintCalendarGrid();
            rerenderCalendarToolbarIfActive();
          } else render();
        },
      })
    )
    .catch((err) => toastError(err, 'Couldn’t open the importer. Check your connection and try again.'));
}

function snoozeMinutes() {
  const v = Number(((state.user && state.user.uiPrefs) || {}).snoozeMinutes);
  return Number.isFinite(v) && v >= 1 && v <= 240 ? Math.round(v) : 10;
}

/** The reminder a bell card came from, if it can ring again. One this device
    hasn't loaded (made on another device since) still offers it: the server
    decides, and only a timed reminder ever reaches the bell. */
function snoozableReminder(n) {
  if (!n || n.kind !== 'reminder' || !n.relatedId) return null;
  const known = (state.reminders || []).find((r) => r.id === n.relatedId);
  if (known && !known.time) return null;
  return { id: n.relatedId };
}

function clockOf(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* minutes null = the default length. notifId: the bell card it came from,
   marked read — a snoozed reminder is dealt with for now. */
async function snoozeReminder(id, minutes, notifId) {
  try {
    const saved = await api('/api/reminders/' + encodeURIComponent(liveId(id)) + '/snooze', {
      method: 'POST',
      body: JSON.stringify(minutes ? { minutes } : {}),
    });
    state.reminders = state.reminders.some((r) => r.id === id)
      ? state.reminders.map((r) => (r.id === id ? keepDone(r, saved) : r))
      : [...state.reminders, saved];
    reSyncDeviceAlarms();
    if (notifId) markNotificationRead(notifId);
    rerenderCalendarSideIfActive();
    repaintReminderSettings();
    toastSuccess('Snoozed. It rings again at ' + formatTime(clockOf(saved.snoozedUntil)) + '.');
    return saved;
  } catch (err) {
    toastError(err, 'Could not snooze that reminder.');
    return null;
  }
}

async function cancelReminderSnooze(id) {
  try {
    const saved = await api('/api/reminders/' + encodeURIComponent(id) + '/snooze', { method: 'DELETE' });
    state.reminders = state.reminders.map((r) => (r.id === id ? keepDone(r, saved) : r));
    reSyncDeviceAlarms();
    rerenderCalendarSideIfActive();
    repaintReminderSettings();
    toastSuccess('Snooze cancelled.');
  } catch (err) {
    toastError(err, 'Could not cancel that snooze.');
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

/* The water nudge's settings. In ui_prefs like every other preference, so they
   follow the user to their next device; the alarms themselves are per-device. */
/* The hours the user drinks in anyway (push.js usualDrinkHours): the water
   nudge drops the alarm right after them, and Home's one-thing card reads it
   (`waterUsualHours`, [] = doesn't log water regularly) to nudge water only
   for people who log it. Fetched when either can use it; Home repaints only
   when the answer changed. */
let waterHoursLoad = null; // boot's request, which wave 2 waits on (loadSecondaryData)
function loadWaterUsualHours() {
  const nudge = waterReminderPrefs().on;
  if (!nudge && !featureOn('water')) return null;
  return api('/api/water/times?days=14')
    .then((times) => {
      const hours = usualDrinkHours(times);
      const changed = JSON.stringify(hours) !== JSON.stringify(state.waterUsualHours);
      state.waterUsualHours = hours;
      if (nudge) reSyncDeviceAlarms();
      // Before wave 2 lands (achReady), loadSecondaryData's own repaint shows it.
      if (changed && state.screen === 'home' && !state.loading && state.achReady) render();
    })
    .catch(() => {});
}

/* History only Insights reads, fetched when Report opens and at most every
   ten minutes after. Each part fails on its own: a missing one only hides its
   cards. Daily habits only: weekly ones have no day to miss. */
let insightHistoryAt = 0;
let insightReq = null; // the fetch in flight, so a re-render doesn't start another
function loadInsightHistory() {
  if (insightReq || Date.now() - insightHistoryAt < 600000) return;
  const req = (insightReq = {});
  const soft = (p) => p.catch(() => null);
  const day = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const daily = (state.habits || []).filter((x) => x.cadence === 'daily');
  Promise.all([
    soft(api('/api/focus/sessions?days=30')),
    soft(api('/api/tasks/finished?days=60')),
    soft(api('/api/water/times?days=14')),
    soft(Promise.all([api('/api/score/day?date=' + day(2)), api('/api/score/day?date=' + day(1))])),
    // One request for every habit; an older server without /history answers
    // 404/405 (its PUT /{id} matches the path), so ask per habit as before.
    (daily.length ? api('/api/habits/history?days=60') : Promise.resolve({}))
      .then((all) => daily.map((x) => (all && all[x.id]) || null))
      .catch((err) =>
        err && (err.status === 404 || err.status === 405)
          ? Promise.all(daily.map((x) => soft(api('/api/habits/' + x.id + '/history?days=60'))))
          : daily.map(() => null)
      ),
    // Boot loads 60 days of daily logs; the year in pixels and records want the year.
    soft(api('/api/daily-logs?days=366')),
    // Every finished day's score, so the trend and pixels are not limited to the two above.
    soft(api('/api/score/range?from=' + day(366) + '&to=' + day(1))),
  ]).then(([focus, finished, waterTimes, scores, hist, year, scoreRange]) => {
    if (insightReq !== req) return; // signed out (or in as someone else) meanwhile
    insightReq = null;
    // Stamped on success only: stamping before the fetch left a failed one (offline,
    // a server blip) unretried for ten minutes. Every part failing is a failure.
    const anyPart = [focus, finished, waterTimes, scores, year, scoreRange].some(Boolean) || hist.some(Boolean);
    if (anyPart) insightHistoryAt = Date.now();
    const habits = {};
    daily.forEach((x, i) => {
      if (hist[i]) habits[x.id] = hist[i];
    });
    if (anyPart || !state.insightHistory) {
      state.insightHistory = { focus, finished, waterTimes, scores, scoreRange, habits, year, failed: !anyPart };
    }
    if (state.screen === 'report') repaintReport();
    else if (state.screen === 'home') render();
  });
}

/* Repaint Report's sections in place: only the ones whose markup changed are
   swapped, and the page is held on whatever section was at the top of the view.
   The year of history landing and the 7/30-day toggle both used to go through
   render(), which rebuilt the whole app and let the sections above you grow
   under your thumb. */
const iconless = (html) =>
  html.replace(/<svg[^>]*lucide[^>]*>[\s\S]*?<\/svg>|<i [^>]*data-lucide[^>]*><\/i>/g, '');
function repaintReport() {
  const old = document.querySelector('.gb-scroll .gb-report');
  const scroll = document.querySelector('.gb-scroll');
  const fresh = old && SCREENS.report.render();
  if (!old || !fresh.classList.contains('gb-report')) return render();
  const focusKey = focusLocator(document.activeElement, root);
  const a = Array.from(old.children);
  const b = Array.from(fresh.children);
  if (a.length !== b.length) {
    old.replaceWith(fresh);
  } else {
    const view = scroll.getBoundingClientRect().top;
    let anchor = null;
    let anchorTop = 0;
    const changed = a.map((n, i) => iconless(n.outerHTML) !== iconless(b[i].outerHTML));
    a.forEach((n, i) => {
      if (!anchor && !changed[i] && n.getBoundingClientRect().bottom > view) {
        anchor = n;
        anchorTop = n.getBoundingClientRect().top;
      }
    });
    a.forEach((n, i) => changed[i] && n.replaceWith(b[i]));
    if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  }
  refreshIcons();
  if (focusKey) refocus(focusKey, root);
}

function waterReminderPrefs() {
  const p = state.user && state.user.uiPrefs;
  return Object.assign({}, WATER_DEFAULTS, (p && p.water) || {});
}

/* Insight ids the user waved away; Report and Home's Outlook share the list. */
function dismissedInsights() {
  const d = state.user && state.user.uiPrefs && state.user.uiPrefs.insightsDismissed;
  return Array.isArray(d) ? d : [];
}
function dismissInsight(id) {
  // Last 50 only: a dismissed card's id is stable, the list must not grow forever.
  const next = [...dismissedInsights().filter((x) => x !== id), id].slice(-50);
  saveUiPrefs({ insightsDismissed: next });
}

/* An insight card's button (insights.js `action` {label, kind, params}). Report
   draws the button; what it does lives here, because it reaches into reminders,
   prefs, tasks and screens that insights.js must not know about. */
function runInsightAction(action) {
  const p = (action && action.params) || {};
  const hm = (mins) =>
    String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  const toMins = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  switch (action && action.kind) {
    case 'bedtimeReminder':
      // The calendar's own form, prefilled: the user still picks the tone and saves.
      prefillCalendarReminder('Wind down for bed', { time: p.time, repeat: p.repeat || 'daily' });
      calToday();
      setScreen('calendar');
      return;
    case 'waterNudge': {
      const at = Number(p.hour) * 60;
      if (!Number.isFinite(at)) return;
      const w = waterReminderPrefs();
      const every = Math.max(30, Number(w.everyMins) || WATER_DEFAULTS.everyMins);
      let from = toMins(w.from) ?? 9 * 60;
      let to = toMins(w.to) ?? 21 * 60;
      // Slots run from `from` every `every` minutes: line the grid up on `at`
      // (moving the start later by less than one step), or start there.
      from = at >= from ? at - Math.floor((at - from) / every) * every : at;
      if (to < at) to = at;
      saveUiPrefs({ water: Object.assign({}, w, { on: true, from: hm(from), to: hm(to) }) });
      reSyncDeviceAlarms();
      toastSuccess('Water nudges on, one at ' + hm(at) + '.');
      return;
    }
    case 'editTask': {
      const t = (state.tasks || []).find((x) => String(x.id) === String(p.taskId));
      if (t) openEditTask(t);
      else pushToast('That task is gone.', 'error', 3200);
      return;
    }
    case 'habitReminder':
      updateHabit(p.habitId, { reminderTime: p.time })
        .then(() => {
          toastSuccess('Reminder moved to ' + p.time + '.');
          render();
        })
        .catch((err) => toastError(err, 'Could not move that reminder.'));
      return;
    case 'openMoney':
      setScreen('money');
      return;
  }
}

/* Re-arm this device's alarm queue — timed reminders plus the water nudge, in
   the chosen chime. Fire-and-forget: a no-op on the web (the server pushes
   there), and a phone that has refused notifications is not an error worth a
   toast. Call it wherever any of the four inputs changes; the queue is
   rebuilt whole, so a stale one rings for a reminder already deleted. */
function reSyncDeviceAlarms() {
  if (!state.user) return; // signed out: endSession's cancelAllAlarms is the last word
  // The queue is rebuilt whole: synced from the empty boot lists it cancelled every
  // reminder and habit alarm, and an offline cold start never re-armed them.
  if (!alarmInputsLoaded) return;
  syncDeviceAlarms({
    reminders: state.reminders,
    water: Object.assign(waterReminderPrefs(), { usualHours: state.waterUsualHours }),
    // A paused habit is out of the server's reminders too (findDeliverable).
    // Muting Habits in Settings → Alerts silences the phone too, not just web push.
    habits: notifyMuted('habits') ? [] : (state.habits || []).filter((x) => x.active !== false),
    sound: notifySound(),
    lead: getDefaultLead(),
    quiet: quietHours(),
    breakPrefs: breakPrefs(),
    snoozeLabel: 'Snooze ' + minutesLabel(snoozeMinutes()),
  }).catch(() => {});
}

/* ---- Buttons on the phone's notifications ----
   Done / Snooze on a reminder, Done on a plain habit, +250 ml on the water
   nudge (push.js builds the sets and stamps `extra`). A press opens the app
   and lands here, through the same handlers the in-app taps use, so the toast
   it shows is the confirmation. A plain tap on the card opens what it is
   about (push.js notificationTarget): the reminder's day on the calendar,
   Habits, Home for water, the timer. On the web the service worker carries
   these out itself, with a signed ticket (public/push-handlers.js). */
let notificationActionsArmed = false;
function armNotificationActions() {
  if (notificationActionsArmed) return;
  notificationActionsArmed = true;
  onLocalNotificationAction((ev) => {
    handleNotificationAction(ev).catch((err) => toastError(err, 'Could not do that from the notification.'));
  });
  // Android carries the buttons out natively; with the app open, show the result.
  onNativeChanges(() => takeNativeChanges().then((changed) => changed && state.user && loadData()));
}

async function handleNotificationAction(ev) {
  const act = ev && ev.actionId;
  const x = (ev && ev.notification && ev.notification.extra) || {};
  if (!state.user || !act || act === 'dismiss') return;
  if (act === 'tap') {
    const to = notificationTarget(x);
    if (!to) return;
    setScreen(to.screen);
    // After the switch: calGoTo repaints the month in place, already on Calendar or not.
    if (to.day) calGoTo(new Date(to.day + 'T12:00:00'));
    return;
  }
  if (x.kind === 'water' && act === 'water') {
    await quickAddWater(WATER_ACTION_ML);
  } else if (x.kind === 'reminder' && act === 'snooze' && x.id) {
    await snoozeReminder(x.id, null);
  } else if (x.kind === 'reminder' && act === 'done' && x.id && x.day) {
    // No day (a snoozed ring): the press already cleared the card; that is all.
    await toggleReminderDone(x.id, x.day, true);
    toastSuccess('Marked done.');
  } else if (x.kind === 'habit' && act === 'done' && x.id) {
    const hb = (state.habits || []).find((h) => h.id === x.id);
    if (!hb) return;
    if (!x.day || x.day === todayKey()) {
      if (!hb.doneToday) await plainToggleHabit(hb.id);
      return;
    }
    // Pressed after midnight: tick the day it rang for, as the habit's history does.
    await api('/api/habits/' + encodeURIComponent(hb.id) + '/checkin', {
      method: 'POST',
      body: JSON.stringify({ date: x.day, done: true }),
    });
    forgetGoalHabitHistory(hb.id);
    toastSuccess(hb.name + ' ticked for ' + shortDay(x.day) + '.');
  }
}

/* Quiet hours (ui_prefs.quietStart / quietEnd, set in Settings > Alerts), or
   null when off. They hold back habit reminders, the water nudge and the
   digest, on the device (push.js isQuietAt) and on the server
   (ReminderPrefs.isQuiet). A timed reminder the user set still rings. */
function quietHours() {
  const p = (state.user && state.user.uiPrefs) || {};
  return p.quietStart && p.quietEnd && p.quietStart !== p.quietEnd
    ? { start: p.quietStart, end: p.quietEnd }
    : null;
}

/* Sleep and lunch, shown on every day of the calendar. In ui_prefs, so it is in
   the database and follows the account; null turns it off. */
function saveRoutine(routine) {
  setRoutine(routine);
  saveUiPrefs({ routine: routine });
  rerenderCalendarSideIfActive();
  if (state.screen === 'home') render(); // Home's day ruler draws it too
  toastSuccess(routine ? 'Routine saved.' : 'Routine turned off.');
}

/* scope: 'this' | 'future' | 'all'. Throws on failure, so the edit dialog can stay open with what was typed.
   A whole-series (or one-off) edit answers with the edited reminder itself, so
   the row is swapped in place at once; a 'this'/'future' edit splits the series
   on the server (a new reminder plus a skip on the original), so only a refetch
   knows the result. */
async function editReminder(scope, id, occKey, patch) {
  try {
    const qs = new URLSearchParams();
    qs.set('scope', scope || 'all');
    if (occKey) qs.set('date', occKey);
    const saved = await api('/api/reminders/' + encodeURIComponent(id) + '?' + qs.toString(), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (saved && saved.id === id) {
      state.reminders = state.reminders.map((r) => (r.id === id ? keepDone(r, saved) : r));
    } else {
      state.reminders = await api('/api/reminders');
    }
    reSyncDeviceAlarms();
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      repaintCalendarGrid();
    } else {
      render();
    }
    toastSuccess('Reminder updated.');
  } catch (err) {
    toastError(err, 'Could not update that reminder.');
    throw err;
  }
}

// scope: 'all' | 'this' | 'future' | 'before'
async function deleteReminder(scope, id, occKey) {
  const repaint = () => {
    reSyncDeviceAlarms();
    repaintReminderSettings();
    if (state.screen === 'calendar') {
      rerenderCalendarSideIfActive();
      repaintCalendarGrid();
    } else {
      render();
    }
  };
  const whole = (scope || 'all') === 'all';
  // Deleting the whole series is the one case whose outcome we can work out
  // locally, so it is undoable: the row goes now and the request follows the
  // toast. The occurrence scopes depend on the server's skip list, so they
  // still wait for the refetch.
  if (whole) {
    if (!state.reminders.some((r) => r.id === id)) return;
    deferDelete({
      message: 'Reminder deleted.',
      errorText: 'Could not delete reminder.',
      paint: repaint,
      ...listSlot(() => state.reminders, (l) => (state.reminders = l), id),
      commit: async () => {
        const path = '/api/reminders/' + encodeURIComponent(realId(id)) + '?scope=all';
        // Offline (or its create still queued): the DELETE waits in the outbox.
        const queue = () => queueWrite({ method: 'DELETE', path, kind: 'reminder.delete', local: { id } });
        if (isTempId(realId(id))) return queue();
        try {
          await api(path, { method: 'DELETE', keepalive: true });
        } catch (err) {
          if (!networkError(err)) throw err;
          return queue();
        }
        if (state.user) reSyncDeviceAlarms();
      },
    });
    return;
  }
  const previous = state.reminders;
  try {
    const qs = new URLSearchParams();
    qs.set('scope', scope || 'all');
    if (occKey) {
      qs.set('date', occKey);
    }
    const path = '/api/reminders/' + encodeURIComponent(realId(id)) + '?' + qs.toString();
    await api(path, { method: 'DELETE' });
    state.reminders = await api('/api/reminders');
    repaint();
    toastSuccess('Reminder deleted.');
  } catch (err) {
    state.reminders = previous;
    repaint();
    toastError(err, 'Could not delete reminder.');
  }
}

/* ---- Modal scaffolding ---- */
/* The shared dialog, plus the one thing only this module can do: repaint the
   app after a successful primary. Every openModal call site in app.js expects
   that, and gb-kit has no business knowing about render(). */
function openModal(opts) {
  return sharedModal({ ...opts, afterPrimary: render });
}

function segmented(options, initial, onChange) {
  let selected = initial;
  const segs = {};
  const wrap = rovingGroup(h('div', { class: 'gb-segmented', role: 'radiogroup' }));
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

/* Quick add's one sentence -> preview (or straight through for controls only).
   Shared by the Quick add bar (quickAddBox) and the command palette.
   `beforeShow` runs once there is something to show (the caller's sheet
   closes); false = nothing read (it has already said why), and a thrown error
   is the caller's to report. `opts.preview`: always show the preview, even for
   controls alone (a share into the app: words the user didn't type here, so
   even "dark mode" waits). `opts.onLogged` / `opts.onCancel`: the preview's
   outcome. `opts.example`: the phrase the can't-read-that toast suggests. */
async function runQuickAdd(text, beforeShow, opts = {}) {
  const example = opts.example || 'spent 200 on lunch, slept 7h';
  const r = await parseQuickAdd(text);
  const skipped = r.skipped || [];
  const rows = r.intents.map((it) => ({ it, d: describeIntent(it) })).filter((x) => x.d);
  if (!rows.length) {
    pushToast(
      skipped.length
        ? skipped.join(' ')
        : r.unavailable
          ? "Couldn't reach the assistant, and couldn't read that without it. Try again?"
          : !r.configured || r.limited
            ? 'Couldn’t read that. Try short phrases like “' + example + '”.'
            : 'Couldn’t find anything to log there. Try short phrases like “' + example + '”.',
      skipped.length ? 'info' : 'error',
      4200
    );
    return false;
  }
  // One clear thing, read by the model: write it now and say it with an Undo.
  // A second dialog to confirm every correct read cost a tap and a screen each
  // time. Several things, a plain-pattern (fallback) read, a row it couldn't
  // match, one that needs a rate, or a share (opts.preview) still get the preview.
  const one = rows.length === 1 && rows[0];
  if (!opts.preview && one && !r.fallback && !skipped.length && !one.d.unknown && !one.d.unticked && !CONTROL_INTENTS.has(one.it.type)) {
    const errBefore = lastError.id;
    const applied = await applyQuickAdd([one.it]);
    if (!applied.length) {
      if (lastError.id === errBefore) pushToast('Couldn’t log that. Try again?', 'error');
      return false;
    }
    if (beforeShow) beforeShow();
    if (opts.onLogged) opts.onLogged();
    announceQuickAdd(applied, 'Logged: ' + one.d.label + (one.d.detail ? ' \u00b7 ' + one.d.detail : ''));
    // As the preview's Log it does: the screen behind shows what was just written.
    await loadData();
    return true;
  }
  if (beforeShow) beforeShow();
  // Only controls ("open money", "dark mode"): just do it — nothing is written
  // that a preview would protect.
  if (!opts.preview && rows.every((x) => CONTROL_INTENTS.has(x.it.type) && !x.d.unknown)) {
    await applyQuickAdd(rows.map((x) => x.it));
    if (opts.onLogged) opts.onLogged();
    return true;
  }
  const sub = [
    r.limited
      ? 'Read without AI this time — switch off anything it got wrong.'
      : r.fallback
        ? 'Read without the assistant — switch off anything it got wrong.'
        : '',
    ...skipped,
  ]
    .filter(Boolean)
    .join(' ');
  openQuickAddPreview(rows, sub, opts.onLogged, opts.onCancel);
  return true;
}

/* Where the Quick add Photo option hands a photo once its kind is picked
   (snap.js). Each one is the existing scanner, entered with the photo in hand. */
const shrinkForSnap = (file) => import('./notes.js').then((m) => m.shrinkPhoto(file));
const SNAP_FEATURE = { receipt: 'money', plate: 'food', groceries: 'family' };
/** SNAP_ROUTES minus the ones whose feature is switched off in Settings, and
    Groceries unless the user is in a family (the pantry is a family's; without
    one the scan 400s). `state.inFamily` comes from GET /api/family: after wave 2
    and whenever the Family screen reads it; unknown = not offered. */
const snapRoutes = () =>
  Object.fromEntries(
    Object.entries(SNAP_ROUTES).filter(
      ([k]) => featureOn(SNAP_FEATURE[k]) && (k !== 'groceries' || state.inFamily === true)
    )
  );
const noteFamily = (r) => {
  state.inFamily = !!(r && r.familyId);
  return r;
};
const SNAP_ROUTES = {
  receipt: (file) =>
    import('./money.js').then((m) =>
      m.openReceiptModal(state.money, saveMoney, requestReceiptScan, { file })
    ),
  plate: (file) => openAddFood({ file }),
  // The pantry is a family's: with no family the server 400s, and that message
  // plus a way to the Family tab is the answer.
  groceries: async (_file, shrunk) => {
    const toFamily = { label: 'View', run: () => setScreen('family') };
    try {
      const res = await api('/api/family/pantry/scan', {
        method: 'POST',
        body: JSON.stringify({ imageDataUrl: await shrunk }),
      });
      const n = (res && res.added && res.added.length) || 0;
      const msg = n
        ? 'Added ' + plural(n, 'item') + ' to your pantry'
        : (res && res.message) || 'Nothing to add from that photo.';
      pushToast(msg, n ? 'success' : 'info', 6000, toFamily);
    } catch (err) {
      const msg = (err && err.message) || 'Join or create a family to use the pantry.';
      pushToast(msg, 'error', 6000, toFamily);
    }
  },
};
// The Quick add bar: one sentence, sorted into the right trackers. Shared by
// openAddSheet and the top of Home (homeQuickAdd); onLeave runs once a parse
// found something, before the preview opens. The line is cleared only once it
// is logged. Cancelling the preview hands the text to onCancel (the sheet,
// closed by onLeave, reopens with it), else focuses this box again. `preview`
// with `text`: read it at once and always show the preview (a share into the app).
function quickAddBox({ onLeave, onCancel, text = '', preview = false } = {}) {
  // Natural-language quick-add: type it once, we sort it into the right trackers.
  // No money example when Money is off. The can't-read-that toast gets the
  // whole example; the placeholder only its first phrase, which fits a 320px
  // phone (the full one was cut at "spent 200 on l").
  const money = featureOn('money');
  const example = money ? 'spent 200 on lunch, slept 7h' : 'slept 7h, call mom at 6';
  const qaInput = h('input', {
    type: 'text',
    class: 'gb-input',
    value: text,
    placeholder: money ? 'e.g. spent 200' : 'e.g. slept 7h',
    'aria-label': 'Quick log in your own words',
    enterkeyhint: 'send',
    autocomplete: 'off',
  });
  const qaBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact' },
    'Log it'
  );
  async function submitQuickAdd() {
    const text = qaInput.value.trim();
    if (!text) return;
    qaInput.disabled = true;
    const done = setThinking(qaBtn, 'Reading');
    try {
      const shown = await runQuickAdd(
        text,
        () => {
          // The Home bar outlives the submit (the sheet closes), so hand it back usable.
          done();
          qaInput.disabled = false;
          onLeave && onLeave();
        },
        {
          preview,
          example,
          onLogged: () => {
            qaInput.value = ''; // cleared only once it is logged
          },
          onCancel: () => {
            if (onCancel) onCancel(qaInput.value);
            else if (qaInput.isConnected) qaInput.focus();
          },
        }
      );
      if (shown) return;
    } catch (err) {
      toastError(err, 'Quick add failed. Try again?');
    }
    done();
    qaInput.disabled = false;
  }
  qaBtn.addEventListener('click', submitQuickAdd);
  qaInput.addEventListener('keydown', (e) => {
    // isComposing: Enter that confirms an IME word (Hindi, Tamil keyboards) isn't a submit.
    if (e.key === 'Enter' && !e.isComposing) {
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
  const capSR = nativePlugin('SpeechRecognition');
  let micBtn = null;
  let langBtn = null;
  if (SR || capSR) {
    const LANGS = VOICE_LANGS.slice(); // the device's own may be added below
    let langCode = speechLang();
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
      // 32px on the right is select.gb-input's room for its arrow.
      style: { width: 'auto', flex: 'none', padding: '8px 32px 8px 12px' },
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

    // listenOnce: the same capture every other mic in the app uses.
    micBtn.addEventListener('click', async () => {
      const said = await listenOnce(micBtn, langCode);
      if (said) gotSpeech(said);
    });
  }

  if (preview && text) setTimeout(submitQuickAdd, 0);

  return h(
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
}

let homeQaNode = null;
let homeQaUser = null;
function homeQuickAdd() {
  // ponytail: one cached node so a Home re-render keeps the typed text and the mic state; rebuild per render if focus loss ever shows up
  // Keyed to the account so a half-typed line never carries over to whoever signs in next.
  const uid = state.user && state.user.id;
  if (homeQaNode && homeQaUser === uid) return homeQaNode;
  homeQaUser = uid;
  return (homeQaNode = quickAddBox());
}

// `prefill`: the Quick add line coming back from a cancelled preview (a string;
// onAdd passes a click event, hence the type check), or `{ text, preview }`, a
// share into the app, read at once into Quick add's preview (runQuickAdd's opts).
function openAddSheet(prefill) {
  const { sheet, close } = openOverlay({ label: 'Quick add' });
  const share = prefill && typeof prefill === 'object' && typeof prefill.text === 'string' ? prefill : null;
  const qaText = typeof prefill === 'string' ? prefill : share ? share.text : '';

  const routes = snapRoutes();
  const opts = [
    {
      key: 'snap',
      // Money, Food and Family all off: no destination, no button.
      hidden: !Object.keys(routes).length,
      icon: 'camera',
      label: 'Photo',
      sub: 'Receipt, meal or groceries',
      action: () => {
        close();
        // Static import: the camera opens inside this tap's gesture (WebKit
        // drops a file-input click that follows an await).
        openSnap({ shrink: shrinkForSnap, api, routes });
      },
    },
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
      feature: 'habits',
      icon: 'repeat',
      label: 'Habit',
      sub: 'Something to do every day',
      action: () => {
        close();
        openAddHabit();
      },
    },
    {
      key: 'note',
      feature: 'notes',
      icon: 'notebook-pen',
      label: 'Note',
      sub: 'Jot something down',
      action: () => {
        close();
        pendingNoteOpen = 'new'; // Notes opens with the composer open and focused
        setScreen('notes');
      },
    },
    {
      key: 'reminder',
      feature: 'calendar',
      icon: 'calendar-plus',
      label: 'Reminder',
      sub: 'What and when, in one line',
      action: () => {
        close();
        openReminderSheet();
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
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'What would you like to add?'),
      h('div', { class: 'gb-modal-sub' }, 'Type it in your own words, or pick one.')
    ),
    // The line comes first and has the focus: "buy milk" is type and Enter
    // (FRC-4); under the rows it was a tap away. Without the AI key the server's
    // plain patterns still read it, and what they read is previewed.
    quickAddBox({ onLeave: close, onCancel: openAddSheet, text: qaText, preview: !!(share && share.preview) }),
    h('div', { class: 'gb-quickadd-or' }, 'or pick one'),
    h(
      'div',
      { class: 'gb-modal-opts' },
      opts
        .filter((o) => !o.hidden && (!o.feature || featureOn(o.feature)))
        .map((o) =>
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
  refreshIcons();
  // Open on the line; back from a cancelled preview, with the caret at its end.
  setTimeout(() => {
    const i = sheet.querySelector('.gb-quickadd-row .gb-input');
    if (!i) return;
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }, 60);
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
function taskForm(task, presetGoalId, presetDue) {
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
    min: '1970-01-02T00:00',
    max: '2037-12-31T23:59',
    value: task && task.dueAt ? toDateTimeLocal(task.dueAt) : presetDue ? toDateTimeLocal(presetDue.toISOString()) : '',
  });
  const dueDefault = dueInput.value; // what Due goes back to when the title stops naming a time
  // Today / Tomorrow set the end of that local day; Pick opens the full picker.
  // No chip is the default, so nothing turns overdue by itself.
  const endOf = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 0, 0);
    return toDateTimeLocal(d.toISOString());
  };
  const dueChips = [
    { label: 'Today', days: 0 },
    { label: 'Tomorrow', days: 1 },
  ].map((c) => h('button', { type: 'button', class: 'gb-chip', 'aria-pressed': 'false', onclick: () => setDue(endOf(c.days)) }, c.label));
  const paintDue = () =>
    dueChips.forEach((b, i) => {
      const on = dueInput.value === endOf(i);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  const setDue = (v) => {
    dueInput.value = dueInput.value === v ? '' : v; // a second tap clears it
    // Not paintDue(): the title's when-parse resets an untouched due on each keystroke, so a chip tap must count as by hand.
    dueInput.dispatchEvent(new Event('input'));
  };
  dueInput.addEventListener('input', paintDue);
  paintDue();
  const pickBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-chip',
      onclick: () => {
        try {
          dueInput.showPicker();
        } catch (_) {
          dueInput.focus();
        }
      },
    },
    'Pick'
  );
  // Goal (optional): the open goals, plus the one the task is already on even
  // if that goal is done, so editing never silently drops the link.
  const goalNow = (task && task.goalId) || presetGoalId || '';
  const goalChoices = (state.goals || [])
    .flatMap((sec) => sec.goals || [])
    .filter((g) => !g.completed || g.id === goalNow);
  const goalSel = goalChoices.length
    ? h(
        'select',
        { class: 'gb-input', 'aria-label': 'Goal' },
        h('option', { value: '' }, 'No goal'),
        goalChoices.map((g) => {
          const o = h('option', { value: g.id }, g.title);
          if (g.id === goalNow) o.selected = true;
          return o;
        })
      )
    : null;

  // "Call plumber tomorrow 5pm": a new task's title can carry its due time
  // (parseWhen, dates.js). It fills Due and shows as a chip; the chip puts the
  // words back as plain title, and a due time picked by hand wins (FRC-11).
  let when = null;
  let dismissed = '';
  let dueByHand = false;
  const whenRow = h('div', { class: 'gb-when-row', 'aria-live': 'polite', hidden: true });
  const paintWhen = () => {
    whenRow.hidden = !when;
    whenRow.replaceChildren(
      ...(when
        ? [
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact gb-when-chip',
                'aria-label': 'Due ' + dueLabel(when.at) + '. Remove, keep \u201c' + when.phrase + '\u201d in the title',
                onclick: () => {
                  dismissed = when.phrase.toLowerCase();
                  when = null;
                  dueInput.value = dueDefault;
                  paintWhen();
                  titleInput.focus();
                },
              },
              Icon('clock', { size: 14, sw: 2.4 }),
              'Due ' + dueLabel(when.at),
              Icon('x', { size: 14, sw: 2.6 })
            ),
          ]
        : [])
    );
    refreshIcons();
  };
  if (!task) {
    titleInput.addEventListener('input', () => {
      if (dueByHand) return;
      const w = parseWhen(titleInput.value);
      when = w && w.phrase.toLowerCase() !== dismissed ? w : null;
      dueInput.value = when ? toDateTimeLocal(when.at.toISOString()) : dueDefault;
      paintWhen();
    });
    dueInput.addEventListener('input', () => {
      dueByHand = true;
      when = null;
      paintWhen();
    });
  }

  return {
    node: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Title'),
      titleInput,
      whenRow,
      h('div', { class: 'gb-field-label' }, 'Priority'),
      priority.node,
      h('div', { class: 'gb-field-label' }, 'Due (optional)'),
      h('div', { class: 'gb-due-chips', role: 'group', 'aria-label': 'Due' }, ...dueChips, pickBtn),
      dueInput,
      goalSel ? h('div', { class: 'gb-field-label' }, 'Goal (optional)') : null,
      goalSel
    ),
    focus: () => focusSoon(titleInput),
    titleInput,
    read: () => {
      const title = visibleText(when ? when.rest : titleInput.value);
      if (!title) throw fieldRefusal(titleInput, 'Give the task a title.');
      // The server's TIMESTAMP column holds 1970 to 2038 (HOS-1).
      if (dueInput.value && (dueInput.value < dueInput.min || dueInput.value > dueInput.max))
        throw fieldRefusal(dueInput, 'Pick a due date between 1970 and 2037.');
      return {
        title,
        priority: priority.get(),
        dueAt: dueInput.value ? new Date(dueInput.value).toISOString() : null,
        // An emptied field means "remove the due date", which a null dueAt
        // can't say on its own — null is how every field in UpdateTaskRequest
        // says "leave it alone". createTask has no such field and ignores it.
        clearDueAt: !dueInput.value,
        // Same shape for the goal: `clearGoal` is how "No goal" is said on a
        // PUT. With no picker (no goals yet) the link is left as it is.
        ...(goalSel
          ? { goalId: goalSel.value || null, clearGoal: !goalSel.value }
          : presetGoalId
            ? { goalId: presetGoalId }
            : {}),
      };
    },
  };
}

/* `goal` — Goals' "Add a task" — preselects that goal. Anything else (a click
   event from a plain onclick) means none. `{ dueToday: true }` (Home's "Add a
   task for today") fills Due with today: an hour from now, 18:00 at the
   earliest, 23:59 when the day is nearly over. It used to open blank, and the
   task landed under "No tasks due on this day". */
function openAddTask(goal) {
  let due = null;
  if (goal && goal.dueToday) {
    due = new Date();
    const hr = Math.max(18, due.getHours() + 1);
    if (hr > 23) due.setHours(23, 59, 0, 0);
    else due.setHours(hr, 0, 0, 0);
  }
  const form = taskForm(null, goal && typeof goal.id === 'string' ? goal.id : null, due);
  // A run of tasks: "Add another" (or Shift+Enter in the title) saves this one
  // and clears the title for the next, keeping priority, due and goal.
  let adding = false;
  const addAnother = async () => {
    if (adding) return;
    adding = true;
    anotherBtn.disabled = true;
    try {
      await createTask(form.read());
      render();
      toastSuccess('Task added.');
      form.titleInput.value = '';
      form.titleInput.focus();
    } catch (err) {
      if (err && err.field) fieldError(err.field, err.message);
      else toastError(err, 'Could not add the task.');
    } finally {
      adding = false;
      anotherBtn.disabled = false;
    }
  };
  const anotherBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--secondary gb-btn--compact', style: { marginTop: '10px' }, onclick: addAnother },
    Icon('plus', { size: 14, sw: 2.4 }),
    'Add another'
  );
  form.titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey && !e.isComposing) {
      e.preventDefault();
      addAnother();
    }
  });
  const close = openModal({
    title: 'New task',
    body: h(
      'div',
      null,
      form.node,
      anotherBtn,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          style: { marginTop: '10px' },
          onclick: () => {
            close();
            openTaskTemplates();
          },
        },
        Icon('list-checks', { size: 14, sw: 2.4 }),
        'Add from a template'
      )
    ),
    primary: 'Add task',
    onPrimary: async () => {
      if (!(await createTask(form.read())).queued) toastSuccess('Task added.');
    },
  });
  form.focus();
}

/* ---- Task templates ----
   A template is a named checklist ("Weekly reset": laundry, groceries, plan
   the week). Adding it creates one task per line. Stored in ui_prefs so they
   follow the user across devices; no table, they're a few short strings. */
function taskTemplates() {
  const list = state.user && state.user.uiPrefs && state.user.uiPrefs.taskTemplates;
  return Array.isArray(list) ? list : [];
}

async function addTemplateTasks(tpl) {
  const res = await Promise.allSettled(
    tpl.items.map((title) =>
      api('/api/tasks', { method: 'POST', body: JSON.stringify({ title, priority: 'Medium' }) })
    )
  );
  // Show the ones the server took even when some failed, so a retry is visibly partial.
  const created = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  state.tasks = [...created.map(mapTask), ...state.tasks];
  await refreshScore();
  if (created.length < res.length) {
    render();
    throw new Error(res.length - created.length + ' of ' + res.length + ' tasks did not save.');
  }
}

function openTaskTemplates() {
  const list = h('div');
  const name = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '60',
    placeholder: 'e.g. Weekly reset',
  });
  const items = h('textarea', {
    class: 'gb-input',
    rows: '4',
    maxlength: '3000',
    placeholder: 'One task per line',
  });
  const paint = () => {
    const tpls = taskTemplates();
    list.replaceChildren(
      ...(tpls.length
        ? tpls.map((tpl) =>
            h(
              'div',
              { class: 'gb-row' },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { class: 'title' }, tpl.name),
                h('div', { class: 'sub' }, tpl.items.join(', '))
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-btn--compact',
                  onclick: async (e) => {
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    try {
                      await addTemplateTasks(tpl);
                      close();
                      render();
                      toastSuccess(plural(tpl.items.length, 'task') + ' added.');
                    } catch (err) {
                      btn.disabled = false;
                      toastError(err, 'Could not add those tasks.');
                    }
                  },
                },
                'Add'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-icon-btn',
                  'aria-label': 'Delete template ' + tpl.name,
                  onclick: () => {
                    saveUiPrefs({ taskTemplates: taskTemplates().filter((x) => x.id !== tpl.id) });
                    paint();
                  },
                },
                Icon('trash-2', { size: 15, sw: 2.4 })
              )
            )
          )
        : [h('div', { class: 'gb-note-hint' }, 'No templates yet. Make one below.')])
    );
    refreshIcons();
  };
  const body = h(
    'div',
    { class: 'gb-form' },
    list,
    h('div', { class: 'gb-field-label' }, 'New template'),
    name,
    items,
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft',
        onclick: () => {
          const lines = items.value
            .split('\n')
            .map((x) => x.trim().slice(0, 255))
            .filter(Boolean)
            .slice(0, 30);
          if (!name.value.trim() || !lines.length) {
            toastError(null, 'Give it a name and at least one task.');
            return;
          }
          saveUiPrefs({
            taskTemplates: [
              ...taskTemplates(),
              { id: String(Date.now()), name: name.value.trim(), items: lines },
            ].slice(-20),
          });
          name.value = '';
          items.value = '';
          paint();
        },
      },
      'Save template'
    )
  );
  const close = openModal({ title: 'Task templates', body });
  paint();
}

/* Hand a task to the calendar's reminder form, like a note's "Add a reminder":
   the date, repeat and tag pickers all live there. A future due date presets the
   day and time; a past or missing one leaves today and the form's own time. */
function remindAboutTask(task) {
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const ahead = due && due > new Date();
  const hhmm = ahead
    ? String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0')
    : null;
  prefillCalendarReminder(task.title.slice(0, 255), hhmm ? { time: hhmm } : null);
  calGoTo(ahead ? due : new Date());
  setScreen('calendar');
}

function openEditTask(task) {
  const form = taskForm(task);
  const close = openModal({
    title: 'Edit task',
    sub: task.title,
    body: h(
      'div',
      null,
      form.node,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          style: { marginTop: '12px' },
          onclick: () => {
            close();
            remindAboutTask(task);
          },
        },
        Icon('calendar-plus', { size: 14, sw: 2.4 }),
        'Add a reminder'
      )
    ),
    primary: 'Save changes',
    onPrimary: () => updateTask(task.id, form.read()),
    danger: {
      label: 'Delete task',
      onClick: () => deleteTask(task.id), // undoable: no confirm
    },
  });
  form.focus();
}

const METRIC_LABEL = { none: 'Just a tick', km: 'Distance (km)', steps: 'Steps', minutes: 'Minutes' };
const METRIC_UNIT = { km: 'km', steps: 'steps', minutes: 'min' };

/* A measured day, as one short line: "5.2 km · 26 min · 12.0 km/h". Speed is
   derived here and nowhere else — a stored speed is a third number that can
   disagree with the two it came from. */
function metricSummary(metric, value, durationMin) {
  if (!metric || metric === 'none' || value == null) return '';
  const unit = METRIC_UNIT[metric] || '';
  const parts = [metric === 'steps' ? Math.round(value).toLocaleString() + ' steps' : value + ' ' + unit];
  if (durationMin) {
    parts.push(durationMin + ' min');
    if (metric === 'km' && durationMin > 0) {
      parts.push((value / (durationMin / 60)).toFixed(1) + ' km/h');
    }
  }
  return parts.join(' · ');
}

function openAddHabit() {
  openHabitForm(null);
}

/* New habit, or edit `habit` (PUT keeps its streak; deleting to rename lost it). */
/* Today in the account's zone (the day the server's UserClock files a check-in
   under and refuses a future one against); the device date when none is set. */
function accountTodayKey() {
  const zone = state.user && state.user.timezone;
  if (zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch (_) {
      /* unknown zone id: the device date */
    }
  }
  return todayKey();
}

/* What quick add read, before any of it is written. Every row is on by default
   and can be switched off, so one wrong reading costs a tap instead of a wrong
   number in a tracker. A habit it couldn't match is off and stays off — there is
   nothing to tick. */
function openQuickAddPreview(rows, note, onLogged, onCancel) {
  // A foreign amount with no rate set (`unticked`) starts off: the user decides.
  const chosen = rows.map((r) => !r.d.unknown && !r.d.unticked);
  let logged = false;
  let primaryBtn = null;
  // Nothing ticked = nothing to log: the button says so by being off.
  const syncPrimary = () => primaryBtn && (primaryBtn.disabled = !chosen.some(Boolean));
  const boxes = [];
  const list = h(
    'div',
    { class: 'gb-qa-preview' },
    rows.map((r, i) => {
      const box = h('input', {
        type: 'checkbox',
        class: 'gb-qa-check',
        checked: chosen[i],
        disabled: !!r.d.unknown,
        'aria-label': r.d.label + ': ' + r.d.detail,
        onchange: (e) => {
          chosen[i] = e.target.checked;
          syncPrimary();
        },
      });
      boxes[i] = box;
      const detail = h('span', null, r.d.detail || '');
      return [
        h(
          'label',
          { class: 'gb-qa-row' + (r.d.unknown ? ' is-unknown' : '') },
          box,
          h('span', { class: 'gb-qa-icon' }, Icon(r.d.icon, { size: 16, sw: 2.4 })),
          h('span', { class: 'gb-qa-copy' }, h('strong', null, r.d.label), detail)
        ),
        r.d.noRate ? rateRow(r, i, detail) : null,
      ];
    })
  );
  /* A foreign amount with no rate: "1 $ = ₹ [  ] Set" writes the rate into the
     Money doc (settings.fx, the same key Customise > Other currencies keeps),
     then re-reads the row converted and ticks it. */
  function rateRow(r, i, detail) {
    const home = homeCur(state.money);
    const sym = r.d.noRate;
    const input = h('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: 'any',
      class: 'gb-input',
      style: { width: '6.5rem', minHeight: '44px' },
      'aria-label': 'Value of 1 ' + sym + ' in ' + home,
      // Enter sets the rate; it must not reach the sheet's submit-on-Enter.
      onkeydown: (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        setBtn.click();
      },
    });
    let setBtn = null;
    const wrap = h(
      'div',
      // Inline layout: the preview's CSS isn't this change's to touch.
      { class: 'gb-qa-rate', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.8125rem', padding: '0 4px' } },
      h('span', null, 'Set a ' + sym + ' rate: 1 ' + sym + ' = ' + home),
      input,
      (setBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => {
            const rate = Number(input.value);
            if (!(rate > 0)) {
              input.focus();
              return;
            }
            const base = state.money;
            const next = normalizeMoney(base);
            next.settings.fx = { ...(next.settings.fx || {}), [sym]: rate };
            saveMoney(next, base);
            r.d = describeIntent(r.it);
            detail.textContent = r.d.detail || '';
            chosen[i] = boxes[i].checked = true;
            syncPrimary();
            wrap.remove();
            if (primaryBtn) primaryBtn.focus();
          },
        },
        'Set'
      ))
    );
    return wrap;
  }
  const one = rows.length === 1;
  openModal({
    title: one ? 'Log this?' : 'Log these?',
    sub: note || 'Switch off anything it read wrong.',
    body: list,
    primary: one ? 'Log it' : 'Log them',
    errorMessage: 'Could not log that.',
    onPrimary: async () => {
      const picked = rows.filter((_, i) => chosen[i]).map((r) => r.it);
      if (!picked.length) throw new Error('Nothing selected — switch at least one on.');
      const errBefore = lastError.id;
      const applied = await applyQuickAdd(picked);
      // A handler that refused has said why: the same text again dedupes to one toast.
      if (!applied.length) throw new Error(lastError.id !== errBefore ? lastError.text : 'None of those could be logged.');
      logged = true;
      // One toast says where things went, with Undo for all of it when every
      // part can be taken back (undoAll).
      announceQuickAdd(applied);
      onLogged && onLogged();
      await loadData();
    },
  });
  // The sheet opened focused on itself, which drew the focus ring round the
  // whole dialog. Start on the primary instead (a11y.js honours [autofocus]),
  // so Enter logs what was read.
  primaryBtn = list.closest('.gb-modal') && list.closest('.gb-modal').querySelector('.gb-btn--primary');
  // Nothing ticked because a rate is missing: start on the rate box instead.
  const firstRate = list.querySelector('.gb-qa-rate input');
  const start = chosen.some(Boolean) || !firstRate ? primaryBtn : firstRate;
  if (start) start.setAttribute('autofocus', '');
  syncPrimary();
  // openModal has no close hook: the preview's own node leaving the page is
  // the close. Not logged by then = cancelled, and the typed line goes back.
  if (onCancel) {
    const watch = new MutationObserver(() => {
      if (list.isConnected) return;
      watch.disconnect();
      if (!logged) onCancel();
    });
    watch.observe(document.body, { childList: true });
  }
}

/* ---- Starter packs (Home's "Getting started") ----
   Pick a goal, see every habit, reminder and target it would add, switch off
   what doesn't fit, one tap writes the rest. planStarter (starter-packs.js) has
   already dropped what exists and what a switched-off feature can't hold. */
function starterRow(it) {
  switch (it.kind) {
    case 'habit':
      return { icon: 'repeat', label: 'Habit', detail: it.name + (it.reminderTime ? ' · ' + formatTime(it.reminderTime) : '') };
    case 'reminder':
      return { icon: 'bell', label: 'Reminder', detail: it.text + ' · ' + REPEATS[it.repeat].label + ', ' + formatTime(it.time) };
    case 'goal':
      return { icon: 'target', label: 'Goal', detail: it.title };
    case 'budget':
      return { icon: 'wallet', label: 'Monthly budget', detail: it.category.charAt(0).toUpperCase() + it.category.slice(1) + ' · ' + fmtIn(it.amount, homeCur(state.money)) + ' (10% under last 30 days)' };
    case 'water':
      return { icon: 'droplets', label: 'Water goal', detail: it.goalMl + ' ml a day' };
    case 'note':
      return { icon: 'wallet', label: 'Monthly budget', detail: 'Suggested from your spending once you have logged some' };
    case 'family':
      return { icon: 'users', label: 'Family', detail: 'Add who you cook for, then plan today’s meals' };
    default:
      return null;
  }
}

async function applyStarter(rows) {
  const today = todayKey();
  const counts = { total: 0 };
  const budgets = {};
  for (const it of rows) {
    try {
      if (it.kind === 'habit') {
        await createHabit({
          name: it.name,
          domain: it.domain || 'habit',
          icon: it.icon,
          cadence: 'daily',
          metric: it.metric || 'none',
          kind: it.habitKind || 'build',
          reminderTime: it.reminderTime || null,
        });
      } else if (it.kind === 'reminder') {
        // Straight to the API: addReminder toasts per row and resets the calendar form.
        state.reminders.push(
          await api('/api/reminders', {
            method: 'POST',
            body: JSON.stringify({ text: it.text, date: today, time: it.time, tag: it.tag, repeat: it.repeat }),
          })
        );
      } else if (it.kind === 'goal') {
        await api('/api/goals', {
          method: 'POST',
          body: JSON.stringify({ title: it.title, horizon: 'short_term', targetDate: it.targetDate }),
        });
      } else if (it.kind === 'water') {
        await updateWaterGoal(it.goalMl);
      } else if (it.kind === 'budget') {
        budgets[it.category] = it.amount;
      } else continue;
      counts[it.kind] = (counts[it.kind] || 0) + 1;
      counts.total++;
    } catch (_) {
      /* one refusal doesn't stop the rest; the count says what landed */
    }
  }
  const nBudgets = Object.keys(budgets).length;
  if (nBudgets) {
    const base = state.money;
    saveMoney({ ...normalizeMoney(base), budgets: { ...base.budgets, ...budgets } }, base);
    counts.budget = nBudgets;
    counts.total += nBudgets;
  }
  return counts;
}

/* What a starter write added, in words: "Added 3 habits, 1 reminder and 1 goal." */
const STARTER_NOUNS = { habit: 'habit', reminder: 'reminder', goal: 'goal', budget: 'budget', water: 'water goal' };
function starterSummary(counts) {
  const parts = Object.keys(STARTER_NOUNS)
    .filter((k) => counts[k])
    .map((k) => plural(counts[k], STARTER_NOUNS[k]));
  return 'Added ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]) + '.';
}

// The chips + live preview, shared by Home's modal and the first-run sheet.
// `mod` is the loaded starter-packs.js; `preselect` fills the preview before any
// tap, so first run opens on a finished plan. apply() throws to keep the sheet open.
function starterPicker({ PACKS, planStarter }, preselect, onChange) {
  const picked = new Set(preselect || []);
  // What is picked, for the first-run sheet's title, subtitle and Start button.
  const changed = () =>
    onChange &&
    onChange({
      labels: PACKS.filter((p) => picked.has(p.id)).map((p) => p.label),
      count: rows.filter((r) => r.it.kind !== 'note' && chosen.get(keyOf(r))).length,
    });
  let rows = [];
  const chosen = new Map(); // row key -> on
  const keyOf = (r) => r.it.kind + ':' + r.d.detail;
  const list = h('div', { class: 'gb-qa-preview' });
  const paint = () => {
    rows = planStarter([...picked], {
      habits: state.habits,
      reminders: state.reminders,
      goals: (state.goals || []).flatMap((s) => s.goals || []),
      features: state.user && state.user.features,
      waterGoalMl: state.water && state.water.goalMl,
      weightKg: state.user && state.user.weightKg,
      money: state.money,
      today: todayKey(),
      suggestWater: suggestWaterGoalMl,
    }).map((it) => ({ it, d: starterRow(it) }));
    list.replaceChildren(
      ...(picked.size && !rows.length
        ? [h('p', { class: 'gb-field-hint' }, 'You already have everything these would add.')]
        : rows.map((r) => {
            // A note row says what isn't added and why; there is nothing to tick.
            const info = r.it.kind === 'note';
            if (!info && !chosen.has(keyOf(r))) chosen.set(keyOf(r), true);
            return h(
              'label',
              { class: 'gb-qa-row' + (info ? ' is-unknown' : '') },
              h('input', {
                type: 'checkbox',
                class: 'gb-qa-check',
                checked: !info && chosen.get(keyOf(r)),
                disabled: info,
                'aria-label': r.d.label + ': ' + r.d.detail,
                onchange: (e) => {
                  chosen.set(keyOf(r), e.target.checked);
                  changed();
                },
              }),
              h('span', { class: 'gb-qa-icon' }, Icon(r.d.icon, { size: 16, sw: 2.4 })),
              h('span', { class: 'gb-qa-copy' }, h('strong', null, r.d.label), h('span', null, r.d.detail))
            );
          }))
    );
    changed();
  };
  const chips = h(
    'div',
    { class: 'gb-starter-packs' },
    PACKS.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-chip' + (picked.has(p.id) ? ' is-on' : ''),
          'aria-pressed': String(picked.has(p.id)),
          onclick: (e) => {
            const on = !picked.has(p.id);
            if (on) picked.add(p.id);
            else picked.delete(p.id);
            e.currentTarget.classList.toggle('is-on', on);
            e.currentTarget.setAttribute('aria-pressed', String(on));
            paint();
          },
        },
        Icon(p.icon, { size: 16, sw: 2.4 }),
        p.label
      )
    )
  );
  paint();
  return {
    body: h('div', null, chips, list),
    picked: () => picked.size, // the first-run goal step reads it
    apply: async () => {
      const all = rows.filter((r) => r.it.kind !== 'note' && chosen.get(keyOf(r))).map((r) => r.it);
      if (!all.length) throw new Error(picked.size ? 'Nothing selected — switch at least one on.' : 'Pick a goal first.');
      // Family meals writes nothing here: the caller opens Family (openFamilyMeals).
      const family = all.some((it) => it.kind === 'family');
      const go = all.filter((it) => it.kind !== 'family');
      if (!go.length) return { family };
      const counts = await applyStarter(go);
      if (!counts.total) throw new Error('None of those could be added.');
      toastSuccess(starterSummary(counts));
      reSyncDeviceAlarms();
      // The pack wrote the first goal, so "Dreamer" would pop over the plan the
      // user is about to look at. What a pack unlocks is marked seen, silently.
      achQuiet = true;
      try {
        await Promise.all([loadData(), loadGoals()]);
        checkAchievements();
      } finally {
        achQuiet = false;
      }
      return { family };
    },
  };
}

/* The Family meals pack's step: who the family is comes first, so Family opens
   on its Add member form; a family that already exists opens on today's meals.
   The flag is read once by SCREENS.family. */
function takeFamilyOpen() {
  const o = state.familyOpen || null;
  state.familyOpen = null;
  return o;
}
function openFamilyMeals() {
  state.familyOpen = state.inFamily ? 'plan' : 'add';
  setScreen('family', { keepToasts: true, force: state.screen === 'family' });
}

// starter-packs.js loads on the tap, like day-plan.js: kept out of the boot chunk.
async function openStarterPacks() {
  const p = starterPicker(await import('./starter-packs.js'));
  openModal({
    title: 'What do you want to work on?',
    sub: 'Pick one or more. We set up the habits, reminders and targets; switch off anything that doesn’t fit.',
    body: p.body,
    primary: 'Set it up',
    errorMessage: 'Could not set that up.',
    onPrimary: async () => {
      const r = await p.apply();
      if (r.family) openFamilyMeals();
      else if (state.screen !== 'home') setScreen('home', { keepToasts: true });
    },
  });
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
  // "11 Oct", never "11/10/2026" (which reads as November in half the world).
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

/* What an empty bell still owes the user: the most overdue High task and the
   longest daily streak that breaks at midnight if today stays unticked. */
function bellPressing() {
  const out = [];
  const now = Date.now();
  const late = (state.tasks || [])
    .filter((t) => !t.done && !t.paused && t.priority === 'High' && t.dueAt && new Date(t.dueAt).getTime() < now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  if (late) {
    out.push({ title: late.title, sub: 'High priority, overdue: due ' + relativeTime(late.dueAt).replace('Just now', 'just now'), run: () => openEditTask(late) });
  }
  const risk = featureOn('habits')
    ? (state.habits || [])
        .filter((x) => !isQuitHabit(x) && (x.cadence || 'daily') === 'daily' && habitDue(x) && !x.doneToday && !x.protectedToday && effectiveStreak(x) > 0)
        .sort((a, b) => effectiveStreak(b) - effectiveStreak(a))[0]
    : null;
  if (risk) {
    out.push({
      title: risk.name,
      sub: 'Your ' + effectiveStreak(risk) + '-day streak ends at midnight. Tick it today.',
      run: () => setScreen('habits'),
    });
  }
  return out;
}

/* ---- Bell dropdown ---- */
function notificationDropdown() {
  if (!state.notifOpen) return null;
  // Every loaded page, narrowed by the chip; "Load older" fetches the next one.
  // (It used to be the newest 12 of an unpaged list, and "Clear all" deleted
  // the lot — PATCH /read-all still does that for builds cached on phones.)
  const items =
    notifFilter === 'all'
      ? state.notifications
      : state.notifications.filter((n) => notifCategory(n) === notifFilter);
  const anyUnread = unreadNotifs() > 0;
  const anyRead = state.notifications.some((n) => n.readAt);
  const card = h('div', { class: 'gb-notif-pop' });
  const headLink = (label, run) => h('button', { type: 'button', class: 'gb-notif-link', onclick: run }, label);
  card.appendChild(
    h(
      'div',
      { class: 'gb-notif-head' },
      h('span', null, 'Notifications'),
      h(
        'div',
        { class: 'gb-notif-head-actions' },
        anyUnread ? headLink('Mark all read', markAllNotificationsRead) : null,
        anyRead ? headLink('Clear read', clearReadNotifications) : null,
        // What reaches this bell is set in Settings, Alerts: three taps away, through the avatar.
        h(
          'button',
          {
            type: 'button',
            class: 'gb-notif-link',
            'aria-label': 'Notification settings',
            title: 'Notification settings',
            onclick: () => {
              state.notifOpen = false;
              repaintOverlays();
              openProfileSettings('notifications');
            },
          },
          Icon('settings', { size: 16 })
        )
      )
    )
  );
  // Nothing at all to filter: the chips only took room above the empty line.
  if (state.notifications.length) card.appendChild(
    h(
      'div',
      { class: 'gb-notif-chips', role: 'group', 'aria-label': 'Show notifications about' },
      NOTIF_FILTERS.map((f) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-notif-chip' + (notifFilter === f.id ? ' is-on' : ''),
            'aria-pressed': notifFilter === f.id ? 'true' : 'false',
            onclick: () => {
              notifFilter = f.id;
              repaintOverlays();
            },
          },
          f.label
        )
      )
    )
  );
  const pressing = !items.length && notifFilter === 'all' ? bellPressing() : [];
  if (pressing.length) {
    // "All caught up" was untrue with a High task overdue and a streak ending
    // tonight: those are what's waiting, one line each, a tap to act.
    pressing.forEach((p) =>
      card.appendChild(
        h(
          'div',
          { class: 'gb-notif-row is-unread' },
          h('div', { class: 'gb-notif-dot' }),
          h(
            'div',
            {
              class: 'gb-notif-body',
              ...activate(() => {
                state.notifOpen = false;
                repaintOverlays();
                p.run();
              }),
            },
            h('div', { class: 'gb-notif-title' }, p.title),
            h('div', { class: 'gb-notif-sub' }, p.sub)
          )
        )
      )
    );
  } else if (!items.length) {
    card.appendChild(
      h(
        'div',
        { class: 'gb-notif-empty' },
        notifFilter === 'all' ? "You're all caught up." : 'Nothing here' + (notifHasMore(notifFilter) ? ' yet.' : '.')
      )
    );
  } else {
    items.forEach((n) => {
      const isMentorshipReq = n.kind === 'mentorship_request' && !n.readAt;
      // Unread only: a snooze marks its card read, so the button going is the receipt.
      const snoozable = !n.readAt && snoozableReminder(n);
      const row = h(
        'div',
        { class: 'gb-notif-row' + (n.readAt ? '' : ' is-unread') },
        h('div', { class: 'gb-notif-dot' }),
        h(
          'div',
          {
            class: 'gb-notif-body',
            // Buddy's evening reflection opens the chat with its question ready.
            ...activate(() => (n.kind === 'buddy_checkin' ? openReflectionCard(n) : markNotificationRead(n.id))),
          },
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
          : snoozable
            ? h(
                'div',
                { class: 'gb-notif-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--ghost gb-notif-snooze',
                    'aria-label': 'Snooze ' + n.title + ' for ' + minutesLabel(snoozeMinutes()),
                    onclick: () => snoozeReminder(snoozable.id, null, n.id),
                  },
                  Icon('alarm-clock', { size: 14 }),
                  minutesLabel(snoozeMinutes())
                )
              )
            : null
      );
      card.appendChild(row);
    });
  }
  if (notifHasMore(notifFilter)) {
    card.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'gb-notif-more',
          disabled: notifPaging.loading,
          onclick: loadOlderNotifs,
        },
        notifPaging.loading ? 'Loading…' : 'Load older'
      )
    );
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

   Keep in step with gb-toast-in's duration in styles/app.css. */
const TOAST_IN_MS = 260;
/* 'info' is the neutral one: a reminder coming due is neither good news nor an
   error, and the alert glyph on a nudge reads as something going wrong. */
const TOAST_ICON = { success: 'check-circle-2', info: 'bell', error: 'circle-alert' };

function toastStack() {
  if (!state.toasts.length) return null;
  const now = Date.now();
  const nodes = state.toasts.map((t) => {
    const age = now - (t.at || 0);
    const entering = age >= 0 && age < TOAST_IN_MS && !leavingToasts.has(t.id);
    return h(
      'div',
      {
        class:
          'gb-toast is-' +
          (t.kind || 'error') +
          (entering ? '' : ' is-settled') +
          (leavingToasts.has(t.id) ? ' is-leaving' : ''),
        style: entering ? { animationDelay: '-' + age + 'ms' } : null,
      },
      h(
        'span',
        { class: 'gb-toast-icon', 'aria-hidden': 'true' },
        Icon(t.icon || TOAST_ICON[t.kind] || 'circle-alert', {
          size: 15,
          sw: 2.4,
        })
      ),
      h('span', { class: 'gb-toast-msg' }, t.message),
      t.action
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-toast-action',
              onclick: () => {
                dismissToast(t.id, true);
                t.action.run();
              },
            },
            t.action.label
          )
        : null,
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
  // No live region here: announce() speaks for the stack (see there).
  return h(
    'div',
    {
      class: 'gb-toast-stack',
      // A real hover only: a toast that appears under a finger on a phone must not
      // hold a deferred delete until the next touch elsewhere.
      onpointerenter: (e) => e.pointerType === 'mouse' && holdToasts(),
      onpointerleave: (e) => e.pointerType === 'mouse' && releaseToasts(),
      onfocusin: holdToasts,
      onfocusout: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) releaseToasts();
      },
    },
    nodes
  );
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
  const reordering = habitReorderMode && state.habits.length > 1;
  const rows = state.habits.map((habit, index) => {
    const fz = habitFreezeState(habit);
    const streak = effectiveStreak(habit);
    const frozenCount = fz && fz.frozen ? fz.frozen.length : 0;
    const daily = !isQuitHabit(habit) && (habit.cadence || 'daily') === 'daily';
    const subChildren = [
      h(
        'span',
        // One piece, so a narrow row never breaks it at "3- / day".
        { style: { whiteSpace: 'nowrap' } },
        isQuitHabit(habit)
          ? quitHabitLabel(habit)
          : (habit.active === false ? 'Paused · ' : '') +
              cadenceLabel(habit) +
              weekProgressLabel(habit) +
              (streak && !daily ? ' · 🔥 ' + streak + '-' + streakUnit(habit) + ' streak' : '')
      ),
    ];
    // A daily habit's streak is its seven-day chain, the same one Home draws.
    if (daily) {
      subChildren.push(
        StreakChain({ streak, doneToday: habit.doneToday, owed: habitDueToday(habit), best: habit.longestStreak })
      );
    }
    const measured = metricSummary(habit.metric, habit.todayValue, habit.todayDurationMin);
    if (measured) {
      subChildren.push(h('span', { class: 'gb-metric-chip' }, measured));
    }
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
      // The name opens Edit, where Delete lives too. Edit and Delete sat on the
      // row as two more 32px icons, and four of them squeezed the name onto two
      // lines on a phone.
      h(
        'button',
        {
          type: 'button',
          class: 'gb-row-open',
          'aria-label': 'Edit habit: ' + habit.name,
          onclick: () => openHabitForm(habit),
        },
        h('span', { class: 'title' }, habit.name),
        h(
          'span',
          {
            class: 'sub',
            style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
          },
          ...subChildren
        )
      ),
      reordering
        ? h(
            'span',
            { class: 'gb-habit-move' },
            h(
              'button',
              {
                type: 'button',
                class: 'gb-icon-btn',
                disabled: index === 0,
                'aria-label': 'Move up: ' + habit.name,
                'data-habit-move': habit.id + ':up',
                onclick: () => moveHabit(habit.id, -1),
              },
              Icon('chevron-up', { size: 18, sw: 2.4 })
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-icon-btn',
                disabled: index === state.habits.length - 1,
                'aria-label': 'Move down: ' + habit.name,
                'data-habit-move': habit.id + ':down',
                onclick: () => moveHabit(habit.id, 1),
              },
              Icon('chevron-down', { size: 18, sw: 2.4 })
            )
          )
        : null,
      !reordering &&
        !isQuitHabit(habit) &&
        habit.active !== false &&
        (habit.cadence || 'daily') === 'daily' &&
        !habit.doneToday
        ? (function () {
            const resting = !!habit.protectedToday;
            const noTokens = !resting && freezeTokensLeft() <= 0;
            // A 0- or 1-day streak has nothing worth a freeze: it was spent for nothing.
            const tooShort = !resting && effectiveStreak(habit) <= 1;
            return h(
              'button',
              {
                type: 'button',
                class: 'gb-rem-del' + (resting ? ' is-active' : ''),
                disabled: noTokens || tooShort,
                'aria-pressed': String(resting),
                'aria-label':
                  (resting ? 'Remove rest day: ' : 'Mark today a rest day: ') +
                  habit.name +
                  (tooShort ? '. Available once the streak is 2 days' : ''),
                title: resting
                  ? 'Rest day — your streak holds today. Tap to undo.'
                  : noTokens
                    ? 'No freezes left this week'
                    : tooShort
                      ? 'Rest days protect a streak of 2 days or more'
                      : 'Mark today a rest day (spends a freeze)',
                onclick: () => toggleRestDay(habit.id, !resting),
              },
              Icon('snowflake', { size: 16, color: resting ? 'var(--brand)' : undefined })
            );
          })()
        : null,
      // Paused: nothing is owed, so there is nothing to tick (the row says "Paused").
      reordering || habit.active === false
        ? null
        : isQuitHabit(habit)
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-slip-btn' + (habit.doneToday ? '' : ' is-slipped'),
                disabled: habit.active === false,
                'aria-label':
                  (habit.doneToday ? 'I slipped: ' : 'Slipped today — undo or add a note: ') +
                  habit.name,
                onclick: () => toggleHabit(habit.id),
              },
              Icon(habit.doneToday ? 'ban' : 'undo-2', { size: 15, sw: 2.4 }),
              habit.doneToday ? 'I slipped' : 'Slipped'
            )
          : Check({
              done: habit.doneToday,
              onToggle: () => toggleHabit(habit.id),
              label: habit.name,
            })
    );
    if (reordering || !fz || !fz.pendingBreak) {
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
    { class: 'gb-rise gb-habits', style: { padding: '0 0 24px' } },
    h(
      'div',
      {
        style: {
          padding: '6px var(--gutter) 10px',
          display: 'flex',
          flexWrap: 'wrap', // large text: Add drops to a second line, not off screen
          gap: '6px 12px',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
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
        'Your habits',
        (() => {
          const owed = state.habits.filter(habitDueToday);
          const done = owed.filter((x) => x.doneToday).length;
          // Just the figure: "today" too wrapped the heading beside Reorder and Add.
          return owed.length
            ? h(
                'span',
                {
                  class: 'gb-habits-today',
                  title: done + ' of ' + owed.length + ' done today',
                  'aria-label': done + ' of ' + owed.length + ' done today',
                },
                done + '/' + owed.length
              )
            : null;
        })()
      ),
      h(
        'div',
        { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        // Reorder swaps each row's tick for up / down arrows: plain buttons, so
        // a keyboard or a screen reader can move a habit as easily as a finger.
        state.habits.length > 1
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn ' + (reordering ? 'gb-btn--primary' : 'gb-btn--ghost'),
                style: { width: 'auto', padding: '8px 12px' },
                'aria-pressed': String(reordering),
                onclick: () => {
                  habitReorderMode = !habitReorderMode;
                  render();
                },
              },
              reordering
                ? 'Done'
                : [Icon('list-ordered', { size: 16, sw: 2.4 }), 'Reorder']
            )
          : null,
        reordering
          ? null
          : h(
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
      )
    ),
    // Its own row: beside Reorder and Add it wrapped to two lines on a phone.
    (function () {
      const left = freezeTokensLeft();
      return h(
        'div',
        { style: { padding: '0 var(--gutter) 10px', marginTop: '-6px' } },
        // A button, not a label: the wallet was the only place freezes were
        // mentioned and there was nowhere to go from it. Protecting a day was
        // reachable only through the at-risk prompt, which covers yesterday
        // and nothing else — so a miss from earlier in the week could not be
        // rescued at all, however many tokens were sitting unspent.
        h(
          'button',
          {
            type: 'button',
            class: 'gb-freeze-chip',
            'data-empty': left > 0 ? 'false' : 'true',
            title: 'Choose which day a freeze covers',
            onclick: openFreezeCalendar,
          },
          Icon('snowflake', { size: 13, sw: 2.4 }),
          // The earning rule was in the title attribute above, which a phone
          // never shows — so on mobile the only place it existed was invisible.
          // "Freeze" alone was jargon on first sight: say what one does.
          left + ' streak freeze' + (left === 1 ? '' : 's') + ' · covers a missed day · +1 a week',
          Icon('chevron-right', { size: 13, sw: 2.6 })
        )
      );
    })(),
    h(
      'div',
      { style: { padding: '0 var(--gutter)' } },
      h('div', { class: 'gb-card gb-habits-list', style: { padding: '4px 0' } }, rows)
    ),
    // Guard on the card, not on the function: it returns null when there's no
    // fitness habit or no sleep logged, and an empty padded div is still a gap.
    (() => {
      const card = HabitSleepInsightCard({ habits: state.habits, wellness: state.wellness });
      return card ? h('div', { style: { padding: '0 var(--gutter)', marginTop: '12px' } }, card) : null;
    })()
  );
}

/* ---- Feature toggles ----
   Users can turn whole features on/off. A feature is ON unless explicitly set
   to false (opt-out), so existing users default to everything enabled. */
const FEATURE_DEFS = [
  { key: 'report', label: 'Progress', desc: 'Progress overview, reflection & milestones' },
  { key: 'habits', label: 'Habits', desc: 'Daily habits & streaks' },
  { key: 'food', label: 'Food & meals', desc: 'Log meals and calories' },
  { key: 'water', label: 'Water tracking', desc: 'Track daily water intake' },
  { key: 'health', label: 'Health data', desc: 'Steps, sleep and heart from your phone' },
  { key: 'goals', label: 'Goals', desc: 'Short, mid & long-term goals' },
  { key: 'notes', label: 'Notes', desc: 'Quick notes and jottings' },
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
  health: 'health',
  focus: 'focus',
  habits: 'habits',
  goals: 'goals',
  notes: 'notes',
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
/** Persist a single feature toggle, update local state, and repaint.
    Every reply carries all the switches: only the newest toggle's is adopted,
    or an older one landing late turned a newer switch back. */
const featureSaves = latestSeq();
async function setFeature(key, value) {
  const n = featureSaves.start('features');
  const updated = await api('/api/auth/features', {
    method: 'PUT',
    body: JSON.stringify({ features: { [key]: value } }),
  });
  if (!featureSaves.isLatest('features', n)) return;
  syncUserSession(updated);
  render();
  // Home's Outlook ranks over the insight history, which was read under the
  // old switches: with Water off it showed no top insight until a reload.
  // Read it again now (it repaints Home when it lands).
  insightHistoryAt = 0;
  loadInsightHistory();
  // The server's score drops what a switched-off feature held; the ring kept the old number.
  refreshScoreLater();
}
/* One feature's on/off row (Settings › Layout), with its rollback-on-failure. */
function featureSwitchRow(def) {
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
}

/* Money's receipt reader, for Add expense on the Money screen and on Home.
   Shrunk the way Notes shrinks a photo: 1280px is enough to read a bill.
   categories: [{key, label}], so the AI tags each line with one the user has. */
function requestReceiptScan(file, categories) {
  return import('./notes.js')
    .then((m) => m.shrinkPhoto(file))
    .then((imageDataUrl) =>
      api('/api/money/receipt-scan', {
        method: 'POST',
        body: JSON.stringify({ imageDataUrl, categories }),
      })
    );
}

/* Home checklist's notifications step: 'ask' until this browser has answered,
   'done' once it allowed, 'blocked' when it refused (a refusal used to tick the
   step, with no reminder able to ring). Web push only; the phone asks from
   maybeAskPermissions. */
function remindersAsk() {
  if (isNative() || !pushSupported()) return null;
  const p = Notification.permission;
  return p === 'granted' ? 'done' : p === 'denied' ? 'blocked' : 'ask';
}

const SCREENS = {
  home: {
    headerLabel: () => todayLabel(),
    headerName: () => greetingFor(new Date().getHours()) + ', ' + firstName(),
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
        goalProgress: effectiveGoalProgress(),
        onOpenGoals: () => setScreen('goals'),
        // Home's day ruler opens Calendar on today, whatever month it was left on.
        onOpenCalendar: () => {
          const t = new Date();
          state.calYear = t.getFullYear();
          state.calMonth = t.getMonth();
          state.selectedDate = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
          setScreen('calendar');
        },
        onAddReminder: openReminderSheet,
        routine: state.user && state.user.uiPrefs && state.user.uiPrefs.routine,
        onAddRoutine: () => openRoutineDialog(saveRoutine),
        // Home's Pending list: the Calendar's own toggle, then Home repaints its counts.
        onReminderDone: (id, key, done) => {
          const p = toggleReminderDone(id, key, done);
          render();
          p.then(() => state.screen === 'home' && render());
        },
        wellness: state.wellness,
        phoneNight: state.phoneNight,
        foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
        dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
        dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
        onAddTask: openAddTask,
        onAddTodayTask: () => openAddTask({ dueToday: true }),
        inFamily: state.inFamily === true,
        onOpenFamily: openFamilyMeals,
        onEditTask: openEditTask,
        onPauseTask: pauseTask,
        onFocusTask: featureOn('focus') ? (task) => startFocusOn({ taskId: task.id }, true) : null,
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
        onStarterPack: openStarterPacks,
        remindersAsk: remindersAsk(),
        onEnableReminders: async () => {
          await enablePushFlow('Notifications on. Your reminders will ring.');
          render();
        },
        setupPending: !((state.user && state.user.uiPrefs) || {}).setupDone,
        onConfirmSleep: (u) => saveSleepEntry({ bedtime: u.bedtime, wakeTime: u.wakeTime }),
        onQuickMood: quickMood,
        onOnboardDismiss: (opts) => {
          saveUiPrefs({ onboardingDone: true });
          // Only from the ✕ click — the all-done path fires mid-render.
          if (opts && opts.rerender) render();
        },
        onAddSuggestedReminder: addSuggestedReminder,
        money: state.money,
        onSaveMoney: saveMoney,
        requestReceiptScan,
        onOpenMoney: () => setScreen('money'),
        onQuickAddWater: featureOn('water') ? quickAddWater : null,
        homeLayout: (state.user && state.user.homeLayout) || null,
        quickAdd: homeQuickAdd(),
        breakEntry: homeBreakEntry(),
        trends: state.trends,
        // Loaded once per session after wave 2 (loadSecondaryData), so Home's
        // top insight matches Report's on a cold start.
        insightHistory: state.insightHistory,
        waterUsualHours: state.waterUsualHours,
        dismissedInsights: dismissedInsights(),
        onDismissInsight: (id) => {
          dismissInsight(id);
          render();
        },
        onInsightAction: runInsightAction,
      }),
  },
  report: {
    headerLabel: () => 'Your progress',
    headerName: () => 'Progress',
    render: () => {
      loadInsightHistory();
      return lazyScreen(
        () => import('./report.js'),
        (m) =>
          m.ScreenReport({
            features: (state.user && state.user.features) || null,
            zone: state.user && state.user.timezone,
            score: score(),
            tasks: state.tasks,
            habits: state.habits,
            goals: state.goals,
            water: state.water,
            food: state.food,
            wellness: state.wellness,
            trends: state.trends,
            money: state.money,
            goalProgress: state.goalProgress,
            insightHistory: state.insightHistory,
            insightLoading: !!insightReq && !state.insightHistory,
            dismissedInsights: dismissedInsights(),
            onDismissInsight: (id) => {
              dismissInsight(id);
              repaintReport();
            },
            onInsightAction: runInsightAction,
            range: state.reportRange,
            onRange: (days) => {
              state.reportRange = days;
              repaintReport();
            },
            weeklyReviews: state.weeklyReviews,
            onMakeHabit: (name) => addHabitNamed(name).then(repaintReport),
          })
      );
    },
  },
  achievements: {
    headerLabel: () => 'Your badges',
    headerName: () => 'Achievements',
    render: () =>
      lazyScreen(
        () => import('./achievements-screen.js'),
        (m) => m.ScreenAchievements(achievementProps())
      ),
  },
  health: {
    headerLabel: () => (isNative() ? 'Your phone and you' : 'Readings you log'),
    headerName: () => 'Health',
    render: () => {
      if (health.readings == null && !health.loading) loadHealthReadings();
      return lazyScreen(
        () => import('./health.js'),
        (m) =>
          m.ScreenHealth({
            native: isNative(),
            today: todayKey(),
            readings: health.readings,
            sleepByDate: (state.wellness && state.wellness.sleepByDate) || {},
            phone: isNative()
              ? {
                  available: health.available,
                  syncing: health.syncing,
                  syncedAt: health.syncedAt,
                  store: /android/i.test(navigator.userAgent) ? 'Health Connect' : 'Apple Health',
                }
              : null,
            onSave: saveHealthReading,
            onUpdate: updateHealthReading,
            onDelete: deleteHealthReading,
            onEditSleep: openSleepSchedule,
            onConnect: connectHealth,
            onSync: () => syncHealthFromPhone({ force: true }),
            // Customise: card order, metric order and what is hidden, in ui_prefs so it follows the user.
            layout: (state.user && state.user.uiPrefs && state.user.uiPrefs.healthLayout) || null,
            onSaveLayout: (healthLayout) => {
              saveUiPrefs({ healthLayout });
              render();
            },
          })
      );
    },
  },
  focus: {
    headerLabel: () => 'Deep work',
    headerName: () => 'Timer',
    render: () =>
      lazyScreen(
        () => import('./timer.js'),
        (m) => m.ScreenFocus(focusProps())
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
        onOpenSummary: () => {
          state.weekError = '';
          setScreen('summary');
        },
        onQuickAddWater: quickAddWater,
        onUpdateWaterGoal: updateWaterGoal,
        onAddFood: openAddFood,
        onDeleteWater: deleteWaterEntry,
        onDeleteFood: deleteFoodEntry,
        onEditFood: openEditFood,
        onCopySlot: copyYesterdaySlot,
        copyableSlots: yesterdaySlots(),
        weightKg: (state.user && state.user.weightKg) || null,
      }),
  },
  summary: {
    headerLabel: () => 'Water & meals',
    headerName: () => 'Summary',
    render: () => {
      // Not on a failed load: that waits for Try again, or every repaint retries.
      if ((!state.foodWeek || !state.waterWeek) && !state.weekError) loadWeekSummary();
      return ScreenSummary({
        features: (state.user && state.user.features) || null,
        week: state.foodWeek,
        water: state.waterWeek,
        check: state.dietCheck,
        error: state.weekError,
        hasWeight: !!(state.user && state.user.weightKg),
        onCheck: runDietCheck,
        onPickDay: runDietCheck,
        onRetry: loadWeekSummary,
        onBack: () => setScreen('food'),
        // A day on the Summary opens it in Calendar, where its meals are listed.
        onOpenDay: (key) => {
          const [y, m] = key.split('-').map(Number);
          state.calYear = y;
          state.calMonth = m - 1;
          state.selectedDate = key;
          setScreen('calendar');
          loadCalendarFoodForDate(key);
        },
      });
    },
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
        habits: state.habits,
        habitHistory: state.insightHistory && state.insightHistory.habits,
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
        onEditReminder: editReminder,
        onCancelSnooze: cancelReminderSnooze,
        onToggleDone: toggleReminderDone,
        onSaveRoutine: saveRoutine,
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
            threadId: mentorThreadId,
            starter: takeMentorStarter(),
            api: mentorApi(),
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
            // Accept / decline an invite addressed to me, from the Circle screen.
            // Same endpoints as the bell's buttons (respondMentorshipRequest).
            onRespond: (requestId, accept) =>
              api(
                '/api/mentorship/requests/' +
                  encodeURIComponent(requestId) +
                  (accept ? '/accept' : '/reject'),
                { method: 'POST' }
              ).then((res) => {
                // The bell card for this invite is gone server-side now.
                state.notifications = state.notifications.filter(
                  (n) => !(n.kind === 'mentorship_request' && n.relatedId === requestId)
                );
                repaintOverlays();
                return res;
              }),
            currentUserId: state.user && state.user.id,
            // "Share a win" chips over a circle's composer, read when a feed opens.
            addHabit: addHabitNamed,
            wins: () => ({
              habits: state.habits || [],
              goals: (state.goals || []).flatMap((sec) => sec.goals || []),
              today: todayKey(),
            }),
            // Inside an accepted link ({id} = the request id): cheer/nudge, the
            // thread, the agreement, and the mentor's weekly card.
            mentorshipApi: {
              nudge: (linkId, kind, text) =>
                api('/api/mentorship/' + encodeURIComponent(linkId) + '/nudge', {
                  method: 'POST',
                  body: JSON.stringify({ kind, text: text || null }),
                }),
              listMessages: (linkId, before) =>
                api(
                  '/api/mentorship/' +
                    encodeURIComponent(linkId) +
                    '/messages' +
                    (before ? '?before=' + encodeURIComponent(before) : '')
                ),
              sendMessage: (linkId, body) =>
                api('/api/mentorship/' + encodeURIComponent(linkId) + '/messages', {
                  method: 'POST',
                  body: JSON.stringify({ body }),
                }),
              setAgreement: (linkId, text) =>
                api('/api/mentorship/' + encodeURIComponent(linkId) + '/agreement', {
                  method: 'PUT',
                  body: JSON.stringify({ text }),
                }),
              week: (linkId) => api('/api/mentorship/' + encodeURIComponent(linkId) + '/week'),
            },
            challengesApi: {
              // Where an invite link points: the public site, never the app's
              // own https://localhost (native.js publicSiteUrl).
              siteUrl: publicSiteUrl() + '/',
              listMine: () => api('/api/circles/mine'),
              listAll: () => api('/api/circles'),
              createCircle: (body) =>
                api('/api/circles', { method: 'POST', body: JSON.stringify(body) }),
              join: (id) =>
                api('/api/circles/' + encodeURIComponent(id) + '/join', { method: 'POST' }),
              joinByCode: (code) =>
                api('/api/circles/join-code', { method: 'POST', body: JSON.stringify({ code }) }),
              leave: (id) =>
                api('/api/circles/' + encodeURIComponent(id) + '/leave', { method: 'POST' }),
              deleteCircle: (id) =>
                api('/api/circles/' + encodeURIComponent(id), { method: 'DELETE' }),
              listMembers: (id) => api('/api/circles/' + encodeURIComponent(id) + '/members'),
              removeMember: (id, userId) =>
                api(
                  '/api/circles/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(userId),
                  { method: 'DELETE' }
                ),
              transfer: (id, userId) =>
                api('/api/circles/' + encodeURIComponent(id) + '/transfer', {
                  method: 'POST',
                  body: JSON.stringify({ userId }),
                }),
              listPosts: (id, before) =>
                api(
                  '/api/circles/' +
                    encodeURIComponent(id) +
                    '/posts' +
                    (before ? '?before=' + encodeURIComponent(before) : '')
                ),
              createPost: (id, body) =>
                api('/api/circles/' + encodeURIComponent(id) + '/posts', {
                  method: 'POST',
                  body: JSON.stringify({ body }),
                }),
              deletePost: (id, postId) =>
                api(
                  '/api/circles/' + encodeURIComponent(id) + '/posts/' + encodeURIComponent(postId),
                  { method: 'DELETE' }
                ),
              toggleKudos: (id, postId) =>
                api(
                  '/api/circles/' +
                    encodeURIComponent(id) +
                    '/posts/' +
                    encodeURIComponent(postId) +
                    '/kudos',
                  { method: 'POST' }
                ),
              listComments: (id, postId) =>
                api('/api/circles/' + encodeURIComponent(id) + '/posts/' + encodeURIComponent(postId) + '/comments'),
              createComment: (id, postId, body) =>
                api('/api/circles/' + encodeURIComponent(id) + '/posts/' + encodeURIComponent(postId) + '/comments', {
                  method: 'POST',
                  body: JSON.stringify({ body }),
                }),
              deleteComment: (id, postId, commentId) =>
                api(
                  '/api/circles/' +
                    encodeURIComponent(id) +
                    '/posts/' +
                    encodeURIComponent(postId) +
                    '/comments/' +
                    encodeURIComponent(commentId),
                  { method: 'DELETE' }
                ),
              cheer: (id, userId) =>
                api('/api/circles/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(userId) + '/cheer', {
                  method: 'POST',
                  body: JSON.stringify({}),
                }),
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
            // Once: the Family meals pack's 'add' / 'plan' (openFamilyMeals).
            open: takeFamilyOpen(),
            api: {
              getFamily: () => api('/api/family').then(noteFamily),
              // A retried POST is answered from IdempotencyFilter, not a second family.
              startSolo: () =>
                api('/api/family/solo', { method: 'POST', headers: { 'Idempotency-Key': newIdemKey() } }),
              addMember: (body) =>
                api('/api/family/members', { method: 'POST', body: JSON.stringify(body) }).then(noteFamily),
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
              useFavourite: (id) =>
                api('/api/family/favourites/' + encodeURIComponent(id) + '/use', { method: 'POST' }),
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
              // Sends the state wanted, not "flip": a retried flip undid itself.
              toggleShopping: (id, checked) =>
                api('/api/family/shopping/' + encodeURIComponent(id) + '/toggle', {
                  method: 'POST',
                  body: JSON.stringify({ checked: !!checked }),
                }),
              transferOwnership: (memberId) =>
                api('/api/family/transfer', { method: 'POST', body: JSON.stringify({ memberId }) }),
              deleteShopping: (id) =>
                api('/api/family/shopping/' + encodeURIComponent(id), { method: 'DELETE' }),
              shoppingFromPantry: () => api('/api/family/shopping/from-pantry', { method: 'POST' }),
              updatePantry: (id, body) =>
                api('/api/family/pantry/' + encodeURIComponent(id), {
                  method: 'PUT',
                  body: JSON.stringify(body),
                }),
              // Chores
              listChores: () => api('/api/family/chores'),
              addChore: (body) =>
                api('/api/family/chores', { method: 'POST', body: JSON.stringify(body) }),
              updateChore: (id, body) =>
                api('/api/family/chores/' + encodeURIComponent(id), {
                  method: 'PUT',
                  body: JSON.stringify(body),
                }),
              toggleChore: (id, done) =>
                api('/api/family/chores/' + encodeURIComponent(id) + '/toggle', {
                  method: 'POST',
                  body: JSON.stringify({ done: !!done }),
                }),
              deleteChore: (id) =>
                api('/api/family/chores/' + encodeURIComponent(id), { method: 'DELETE' }),
              // In the assignee's calendar when they have an account here, else in ours:
              // sentTo null means ours, so our list and device alarms need the new row.
              remindChore: (id, time) =>
                api('/api/family/chores/' + encodeURIComponent(id) + '/remind', {
                  method: 'POST',
                  body: JSON.stringify({ time }),
                }).then(async (res) => {
                  if (!res || !res.sentTo) {
                    state.reminders = await api('/api/reminders');
                    reSyncDeviceAlarms();
                  }
                  return res;
                }),
              addReminder: (body) =>
                api('/api/reminders', { method: 'POST', body: JSON.stringify(body) }).then(
                  (created) => {
                    state.reminders.push(created);
                    reSyncDeviceAlarms();
                    return created;
                  }
                ),
              // Plan history + cook per meal
              planHistory: () => api('/api/family/plans/history'),
              reusePlan: (planId) =>
                api('/api/family/meal-plan/' + encodeURIComponent(planId) + '/reuse', {
                  method: 'POST',
                }),
              assignCook: (planId, body) =>
                api('/api/family/meal-plan/' + encodeURIComponent(planId) + '/cook', {
                  method: 'PUT',
                  body: JSON.stringify(body),
                }),
              assignWeeklyCook: (planId, body) =>
                api('/api/family/meal-plan/multi/' + encodeURIComponent(planId) + '/cook', {
                  method: 'PUT',
                  body: JSON.stringify(body),
                }),
              // Recipes (per dish)
              listRecipes: () => api('/api/family/recipes'),
              saveRecipe: (body) =>
                api('/api/family/recipes', { method: 'PUT', body: JSON.stringify(body) }),
            },
          })
      ),
  },
  money: {
    headerLabel: () => 'Spend & save well',
    headerName: () => 'Money Buddy',
    render: () =>
      lazyScreen(
        () => import('./money-screen.js'),
        (m) =>
          m.ScreenMoney({
            money: state.money,
            onSaveMoney: saveMoney,
            requestAdvice: (payload) =>
              api('/api/money/advice', { method: 'POST', body: JSON.stringify(payload) }),
            requestReceiptScan,
            accountRequest,
            // Behind the save queue, like accountRequest: asked the moment an expense is
            // added, it read the day without it, and money.js kept that under the new key.
            requestDaySummary: (day) => {
              const run = moneySaveQueue
                .then(flushLedger)
                .then(() => api('/api/money/day-summary?date=' + encodeURIComponent(day)));
              moneySaveQueue = run.catch(() => {});
              return run;
            },
            // "Load older" in the expense list: history before the 400-day load. View-only
            // in money.js, never merged into state.money, so no save can send it back.
            requestOlderTx: (before) =>
              api('/api/money/tx?before=' + encodeURIComponent(before) + '&limit=200'),
            loadFailed: !!(state.loadFailed && state.loadFailed.has('money')),
            onRetryLoad: () => loadSecondaryData(),
            // The CSV import waits on this between batches: true once nothing is left unsent.
            moneySettled: moneySettledFor(sessionGen()),
          })
      ),
  },
  notes: {
    headerLabel: () => 'Think out loud',
    headerName: () => 'Notes',
    render: () =>
      lazyScreen(
        () => import('./notes.js'),
        (m) =>
          m.ScreenNotes({
            // The screen owns its list rather than living in `state`: notes are
            // read on one screen and nowhere else, so loading them at boot would
            // buy nothing but a slower boot.
            // Notes still in the outbox lead the list until the server has them.
            onList: (opts) =>
              api('/api/notes' + (opts && opts.archived ? '?archived=true' : '')).then((data) =>
                opts && opts.archived ? data : queuedNotes().concat(Array.isArray(data) ? data : [])
              ),
            onTrash: () => api('/api/notes/trash'),
            onCounts: () => api('/api/notes/counts'),
            onDeleteForever: (id) =>
              api('/api/notes/' + encodeURIComponent(id) + '/forever', { method: 'DELETE' }),
            // Keys the offline copy of the list, so one account never sees another's.
            userId: state.user && state.user.id,
            onGet: (id) => {
              const queued = isTempId(realId(id)) && queuedNotes().find((n) => n.id === id);
              return queued ? Promise.resolve(queued) : api('/api/notes/' + encodeURIComponent(realId(id)));
            },
            // Text only goes in the outbox offline: a photo is too big to sit in it.
            onCreate: (body, idemKey = newIdemKey()) =>
              api('/api/notes', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(body) }).catch((err) => {
                if (!networkError(err) || body.cover || /<img/i.test(body.body || '')) throw err;
                const now = new Date().toISOString();
                const local = { ...body, id: tempId(), pinned: false, createdAt: now, updatedAt: now };
                queueWrite({ method: 'POST', path: '/api/notes', body, kind: 'note.create', tempId: local.id, local, idemKey });
                return local;
              }),
            onUpdate: (id, body) =>
              isTempId(realId(id))
                ? Promise.reject(new Error('This note is still waiting to sync. Edit it once it has.'))
                : api('/api/notes/' + encodeURIComponent(realId(id)), {
                    method: 'PATCH',
                    body: JSON.stringify(body),
                  }),
            onDelete: (id) =>
              isTempId(realId(id))
                ? Promise.resolve(queueWrite({ method: 'DELETE', path: '/api/notes/' + id, kind: 'note.delete' })).then(() => null)
                : api('/api/notes/' + encodeURIComponent(realId(id)), { method: 'DELETE' }),
            onGetDraft: () => api('/api/notes/draft'),
            onSaveDraft: (draft) =>
              api('/api/notes/draft', { method: 'PUT', body: JSON.stringify(draft) }),
            onDeleteDraft: () => api('/api/notes/draft', { method: 'DELETE' }),
            // Undo for a delete (soft on the server), and the open edit's own draft.
            onRestore: (id) =>
              api('/api/notes/' + encodeURIComponent(id) + '/restore', { method: 'POST' }),
            onGetEditDraft: (id) => api('/api/notes/' + encodeURIComponent(id) + '/draft'),
            onSaveEditDraft: (id, draft) =>
              api('/api/notes/' + encodeURIComponent(id) + '/draft', {
                method: 'PUT',
                body: JSON.stringify(draft),
              }),
            onDeleteEditDraft: (id) =>
              api('/api/notes/' + encodeURIComponent(id) + '/draft', { method: 'DELETE' }),
            onMakeTask: (title) => createTask({ title }),
            // The palette's pick: a note id to open, or 'new' for the composer. Taken once.
            openOnMount: (() => {
              const id = pendingNoteOpen;
              pendingNoteOpen = null;
              return id;
            })(),
            onMakeReminder: (text) => {
              // Hand it to the calendar rather than growing a second reminder
              // form here — the date, repeat and tag pickers all live there.
              prefillCalendarReminder(text);
              calToday();
              setScreen('calendar');
            },
          })
      ),
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
            // Undoable (deferDelete); a failed send puts it back and toasts.
            onDeleteGoal: (id) => deleteGoal(id),
            // Linked tasks: "Add a task" opens New task on this goal; the open
            // ones listed on the card tick like Home's rows.
            onAddTask: (goal) => openAddTask(goal),
            onToggleTask: toggleTask,
            onAddAction: addGoalAction,
            onUpdateAction: updateGoalAction,
            onDeleteAction: deleteGoalAction,
            goalProgress: effectiveGoalProgress(),
            onUpdateGoalProgress: updateGoalProgress,
            onUpdateGoal: updateGoal,
            onLoadActions: loadGoalActions,
            onFocusGoal: featureOn('focus') ? (goal) => startFocusOn({ goalId: goal.id }) : null,
            // Linked habits: the picker's list, and what each goal's links add up to.
            habits: (state.habits || []).map((x) => ({ id: x.id, name: x.name })),
            linkedHabits: goalHabitSummary(),
            // Action dates are checked against the account's zone (UserClock).
            timezone: (state.user && state.user.timezone) || '',
            loadFailed: !!state.goalsFailed,
            onRetry: loadGoals,
          })
      ),
  },
};

/* ---- Render ---- */
const root = document.getElementById('root');
let renderedScreen = '';

/* ---- Lazy screens ----
   Screens that export nothing the boot path needs don't belong in the boot
   chunk: family, circle, timer, goals, report, mentor, notes and money are
   source a user landing on Home never touches. Money joined once its document
   model moved to money-core.js and Home's card to money-home.js; money.js is
   still reached from Settings (MoneyCustomisePane, via lazyScreen) and the
   card's "Add expense" (import on tap).

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

/* Modules lazyScreen has already loaded, keyed by the loader's source (each
   call site passes a fresh arrow, but its text is the same). Once a chunk is in,
   the screen builds synchronously: going through import() again put the grey
   placeholder up for a frame on every tap on Goals, Report, Timer and Notes. */
const lazyModules = new Map();

function lazyScreen(loader, build) {
  const cached = lazyModules.get(String(loader));
  if (cached) {
    try {
      return build(cached);
    } catch (err) {
      console.error('Screen failed to render', err);
      return CrashCard(() => render());
    }
  }
  const placeholder = screenSkeleton();
  loader()
    .then((mod) => {
      lazyModules.set(String(loader), mod);
      // A later render() may have swapped this placeholder out already; that
      // render made its own, so this one is stale and must not resurrect itself.
      // A chunk that loaded proves this build is being served, so the next
      // deploy gets its own single recovery reload. Cleared here and not on
      // boot: a boot happens after the reload too, and clearing it there wiped
      // the guard that stops a still-missing chunk reloading forever.
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch (_) {
        /* private mode */
      }
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(build(mod));
      refreshIcons();
      // render() restored scroll against the short skeleton, which clamped it to
      // the top; restore again now the real screen is tall enough to hold it.
      restoreScrollPosition(lastScrollSnapshot);
    })
    .catch((err) => {
      console.error('Screen failed to load', err);
      // A deploy renames every hashed chunk. A tab that was already open still
      // asks for the old name, the server no longer has it, and the import
      // rejects — which is why Circle and Family "sometimes" refused to open
      // and were fine after a manual reload. Reload once, which picks up the
      // new index and the new chunk names; the flag makes it once per tab, so
      // a genuinely broken module still lands on the crash card instead of
      // reloading forever.
      // Offline it is not a stale deploy: the screen was never fetched on this
      // device, and a reload with no controlling service worker lands on the
      // browser's own offline page, with the app gone. Say so, and open it
      // when the connection comes back.
      if (isStaleChunkError(err) && !navigator.onLine) {
        if (!placeholder.isConnected) return;
        const card = CrashCard(() => render(), {
          title: 'This screen needs a connection the first time',
          body: 'It hasn’t been opened on this device yet. It opens by itself once you’re back online.',
        });
        placeholder.replaceWith(card);
        refreshIcons();
        window.addEventListener('online', () => card.isConnected && render(), { once: true });
        return;
      }
      if (reloadIfStaleChunk(err)) return;
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(CrashCard(() => render()));
      refreshIcons();
    });
  return placeholder;
}

const CHUNK_RELOAD_KEY = 'gb.chunkReloaded';

/* Every lazy chunk's failure goes through here (lazyScreen, Settings, the habit
   dialogs): true when it reloaded the page for a stale chunk. */
function reloadIfStaleChunk(err) {
  if (!isStaleChunkError(err) || sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch (_) {
    /* private mode: the caller's own error path */
  }
  location.reload();
  return true;
}

/* A dynamic import that failed because the file is gone, not because the module
   threw. Browsers word this differently and none of them give it a code, so the
   message is all there is. */
function isStaleChunkError(err) {
  const msg = String((err && err.message) || err || '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

function bottomNav() {
  return BottomNav({
    active: state.screen,
    onNav: (id) => setScreen(id, { tab: true }),
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
/* The header isn't rebuilt by repaintOverlays, so its two triggers are told
   directly; render() calls it too, or a fresh header announced no state at all. */
function syncHeaderExpanded() {
  const head = document.querySelector('.gb-head');
  head?.querySelector('.gb-bell')?.setAttribute('aria-expanded', String(!!state.notifOpen));
  head?.querySelector('.gb-avatar')?.setAttribute('aria-expanded', String(!!state.profileOpen));
  syncPanelHistory();
}

/* The bell, account and More panels in the back stack (gb-kit trackOverlay):
   Android back and history.back() close an open panel instead of leaving the
   screen, or at Home minimising the app. One entry for the three, since one
   replaces another in a tap. Driven from syncHeaderExpanded, which every paint
   of the flags goes through. */
let panelUntrack = null;
function syncPanelHistory() {
  const open = state.notifOpen || state.profileOpen || state.moreOpen;
  if (open && !panelUntrack) {
    panelUntrack = trackOverlay({
      close: () => {
        state.notifOpen = state.profileOpen = state.moreOpen = false;
        if (state.user) repaintOverlays();
        else syncPanelHistory();
      },
    });
  } else if (!open && panelUntrack) {
    const untrack = panelUntrack;
    panelUntrack = null;
    untrack();
  }
}

/* Both header panels into their slots. render() builds the header with them
   empty; without this a render while one was open (a data load, the poll) left
   the bell "expanded" over nothing. */
function fillHeaderSlots() {
  document.getElementById('gb-notif-slot')?.replaceChildren(...[notificationDropdown()].filter(Boolean));
  document.getElementById('gb-profile-slot')?.replaceChildren(...[profileDropdown()].filter(Boolean));
}

function repaintOverlays() {
  const notif = document.getElementById('gb-notif-slot');
  const profile = document.getElementById('gb-profile-slot');
  const nav = document.querySelector('.gb-nav-wrap');
  if (!notif || !profile || !nav) {
    render();
    return;
  }
  fillHeaderSlots();
  syncHeaderExpanded();
  const wasInMore = !!document.activeElement?.closest('.gb-more-sheet');
  nav.replaceWith(bottomNav());
  // The sheet is rebuilt, so focus is placed by hand: into it on open, back on
  // its More button when it closes from inside (Escape, or a tap on an item
  // that doesn't navigate away).
  if (state.moreOpen) document.querySelector('.gb-more-sheet .gb-more-item')?.focus();
  else if (wasInMore) document.querySelector('.gb-nav-tab--more')?.focus();
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
  const text = n > 99 ? '99+' : String(n);
  bell.setAttribute('aria-label', n ? 'Notifications, ' + text + ' unread' : 'Notifications');
  if (!n) {
    if (badge) badge.remove();
    return;
  }
  if (badge) badge.textContent = text;
  else bell.appendChild(h('span', { class: 'gb-bell-badge' }, text));
}

/* ---- Pull to refresh ----------------------------------------------------
   A WebView gives you no pull-to-refresh, and the app never had one: swiping
   down at the top of a screen did nothing at all. This is the whole gesture —
   drag from a scroll position of 0, past a threshold, and let go.

   Attached once to the document rather than to `.gb-scroll`, because render()
   replaces that element and a listener on it would be thrown away with it.
   Only vertical drags that start at the very top are claimed; anything else
   (a horizontal swipe, a drag begun mid-scroll) is left alone so normal
   scrolling and the calendar's side-swipes still work. */
const PTR_TRIGGER = 72; // px of pull that counts as "refresh"
const PTR_MAX = 110; // how far the indicator travels at most
let ptr = null;

function pullIndicator() {
  let el = document.getElementById('gb-ptr');
  if (!el) {
    el = h('div', { id: 'gb-ptr', class: 'gb-ptr', 'aria-hidden': 'true' }, Icon('refresh-cw', { size: 18 }));
    document.body.appendChild(el);
    refreshIcons();
  }
  return el;
}

function initPullToRefresh() {
  // Only touchstart is always on, and it's passive. The touchmove that has to
  // preventDefault is non-passive, and a non-passive touchmove on the document
  // makes the browser wait on the main thread before every scroll on every
  // screen, so it's attached only for a touch that began at scrollTop 0 and
  // dropped again the moment the drag isn't a downward pull.
  const stop = () => document.removeEventListener('touchmove', onMove, { passive: false });
  document.addEventListener(
    'touchstart',
    (e) => {
      ptr = null;
      stop();
      if (e.touches.length !== 1 || state.loading) return;
      // Not while a dialog is up: the sheet scrolls, the page behind it must not.
      if (document.querySelector('.gb-modal-overlay')) return;
      const scroll = e.target.closest && e.target.closest('.gb-scroll');
      if (!scroll || scroll.scrollTop > 0) return;
      ptr = { scroll, y0: e.touches[0].clientY, x0: e.touches[0].clientX, claimed: false };
      document.addEventListener('touchmove', onMove, { passive: false });
    },
    { passive: true }
  );

  function onMove(e) {
    if (!ptr || e.touches.length !== 1) return stop();
    const dy = e.touches[0].clientY - ptr.y0;
    const dx = e.touches[0].clientX - ptr.x0;
    if (!ptr.claimed) {
      // Decide once, on the first meaningful movement: a drag that is mostly
      // sideways belongs to whatever is under it.
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        ptr = null;
        return stop();
      }
      ptr.claimed = true;
    }
    if (ptr.scroll.scrollTop > 0) {
      ptr = null;
      pullIndicator().style.transform = '';
      return stop();
    }
    // Resisted, so it feels like pulling against something rather than free
    // dragging, and never runs past PTR_MAX.
    const pulled = Math.min(PTR_MAX, dy * 0.5);
    const el = pullIndicator();
    el.style.transform = 'translate(-50%, ' + pulled + 'px) rotate(' + pulled * 3 + 'deg)';
    el.classList.toggle('is-ready', pulled >= PTR_TRIGGER);
    e.preventDefault(); // stops the WebView's own rubber-band fighting it
  }

  const release = () => {
    stop();
    if (!ptr) return;
    const el = pullIndicator();
    const ready = el.classList.contains('is-ready');
    el.classList.remove('is-ready');
    el.style.transform = '';
    ptr = null;
    if (ready) {
      el.classList.add('is-spinning');
      loadData().finally(() => el.classList.remove('is-spinning'));
    }
  };
  document.addEventListener('touchend', release, { passive: true });
  document.addEventListener('touchcancel', release, { passive: true });
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
  // At the top there is nothing to restore (a fresh .gb-scroll starts there), and
  // reading scrollHeight would force a layout of the tree just built.
  if (!snapshot.top && !snapshot.left) return;
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
    throw new Error(NO_CONNECTION);
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
    // ApiException's machine-readable reason: totp_required, totp_invalid,
    // deletion_scheduled. Absent on every other refusal.
    err.code = (payload && payload.code) || '';
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

/* The sign-in card's crest: a week of growth, a seed on the left and a bloom on
   the right, rooted on the card's top edge. Static markup with nothing from the
   user in it, so a string is fine. It grows in once per page load; every
   re-render after that (renderAuth on a typo) draws it already grown. */
let gardenGrown = false;
const GARDEN_SVG = (() => {
  const xs = [24, 66, 108, 150, 192, 234, 276];
  const hs = [0, 14, 26, 40, 52, 64, 74];
  const leaf = (x, y, dir, i) =>
    '<path class="gb-garden-leaf gb-garden-leaf--' +
    (dir > 0 ? 'r' : 'l') +
    '" style="--i:' +
    i +
    '" d="M' +
    x +
    ' ' +
    y +
    'q' +
    5 * dir +
    ' -9 ' +
    11 * dir +
    ' -6q' +
    -5 * dir +
    ' 8 ' +
    -11 * dir +
    ' 6z"/>';
  let out = '<ellipse class="gb-garden-seed" cx="24" cy="92" rx="5" ry="3.5"/>';
  for (let i = 1; i < 7; i++) {
    const x = xs[i];
    const top = 96 - hs[i];
    out +=
      '<path class="gb-garden-stem" style="--i:' +
      i +
      '" pathLength="100" d="M' +
      x +
      ' 96Q' +
      (x - 3) +
      ' ' +
      (96 - hs[i] / 2) +
      ' ' +
      x +
      ' ' +
      top +
      '"/>';
    // Leaves alternate up the stem, one more pair every other day.
    const pairs = Math.ceil(i / 2);
    for (let k = 0; k < pairs; k++) {
      const y = 96 - hs[i] * (0.4 + 0.5 * ((k + 1) / (pairs + 1)));
      out += leaf(x, Math.round(y), k % 2 ? -1 : 1, i);
    }
    if (i === 1) out += leaf(x, top, 1, i);
  }
  out += '<circle class="gb-garden-bud" cx="234" cy="' + (96 - 64) + '" r="4"/>';
  const by = 96 - 74;
  out += '<g class="gb-garden-bloom">';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    out +=
      '<circle cx="' +
      (276 + Math.cos(a) * 5.5).toFixed(1) +
      '" cy="' +
      (by + Math.sin(a) * 5.5).toFixed(1) +
      '" r="5"/>';
  }
  out += '<circle class="gb-garden-heart" cx="276" cy="' + by + '" r="3.5"/></g>';
  return (
    '<svg viewBox="0 0 300 96" aria-hidden="true" focusable="false" overflow="visible">' +
    out +
    '</svg>'
  );
})();

function authShell(title, subtitle, children) {
  const garden = h('div', { class: 'gb-garden' + (gardenGrown ? '' : ' is-growing') });
  garden.innerHTML = GARDEN_SVG;
  gardenGrown = true;
  return h(
    'div',
    { class: 'gb-login-wrap' },
    h(
      'div',
      { class: 'gb-login-card gb-rise' },
      garden,
      h(
        'div',
        { class: 'gb-login-brand' },
        Icon('sprout', { size: 28, color: 'var(--brand)' }),
        h('span', null, 'Growth Buddy')
      ),
      h('h1', { class: 'gb-login-title' }, title),
      subtitle ? h('p', { class: 'gb-login-sub' }, subtitle) : null,
      state.authNotice
        ? h('p', { class: 'gb-login-notice', role: 'status' }, state.authNotice)
        : null,
      // A real <form> so password managers recognise the fields. The views
      // submit from their own Enter handlers and button; this only stops a
      // native submit from reloading the page. display: contents in app.css.
      h(
        'form',
        { class: 'gb-login-form', novalidate: true, onsubmit: (e) => e.preventDefault() },
        children
      ),
      // A request in flight when the session expired lands its own "session
      // expired" here, under the notice that already says so.
      state.error && !state.errorField && !(state.authNotice && state.error === SESSION_EXPIRED)
        ? h('p', { class: 'gb-login-error', role: 'alert' }, state.error)
        : null,
      h('p', { class: 'gb-login-legal' }, privacyLink())
    )
  );
}

/* The hosted policy. Absolute (publicSiteUrl), so in the app it opens in the
   system browser instead of replacing the app inside its own WebView. */
function privacyLink() {
  return h(
    'a',
    { class: 'gb-login-link', href: publicSiteUrl() + '/privacy.html', target: '_blank', rel: 'noopener' },
    'Privacy policy'
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
  // Label and error tied to the input, so a screen reader names the field and
  // reads its error (role=alert announces it the moment it appears).
  const id = 'gb-auth-' + (key || label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  input.id = id;
  if (bad) input.setAttribute('aria-describedby', id + '-err');
  return [
    h('label', { class: 'gb-login-label', for: id }, label),
    node,
    bad ? h('p', { class: 'gb-login-fielderr', id: id + '-err', role: 'alert' }, state.error) : null,
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
    // Reachable by Tab: a keyboard user must be able to check what they typed.
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

/* The steps after a right password (AuthService.login): the authenticator
   code (401 totp_required) or the cancel-deletion screen (409
   deletion_scheduled). Both re-send the same email + password, so they live in
   state.authPending — memory only, never sessionStorage: a reload lands back
   on plain sign-in. Returns whether it took over. */
function routeSignInStep(err, email, password, cancelDeletion) {
  if (!err || (err.code !== 'totp_required' && err.code !== 'deletion_scheduled')) return false;
  state.authPending = {
    email,
    password,
    cancelDeletion: !!cancelDeletion,
    message: err.code === 'deletion_scheduled' ? err.message : (state.authPending || {}).message,
  };
  setAuthMode(err.code === 'totp_required' ? 'totp' : 'deletion', { email });
  return true;
}

/* Every sign-in lands here (password, OTP verify, reset, 2FA, cancel-deletion).
   It starts from session.js's fresh state, not whatever is in memory: an answer
   the last session sent before it ended can still have rolled something back
   into `state` on its way out. */
async function completeSignIn(user) {
  Object.assign(state, freshUserState(EMPTY_STATE), { loading: state.loading });
  syncUserSession(user);
  state.wellness = loadWellness();
  state.goalProgress = loadGoalProgress();
  state.money = loadMoney();
  state.streakFreeze = loadStreakFreeze();
  state.trends = loadTrends();
  landAfterSignIn();
  await loadData();
}

function backToSignin() {
  const email = (state.authPending && state.authPending.email) || state.authEmail;
  state.authPending = null;
  setAuthMode('signin', { email });
}

/* ---- Two-step sign-in: the authenticator code, or a recovery code ---- */
function viewTotp() {
  const p = state.authPending;
  // Not one-time-code boxes: a recovery code has letters and a hyphen.
  const codeInput = h('input', {
    type: 'text',
    class: 'gb-input gb-login-input',
    autocomplete: 'one-time-code',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: 32,
    placeholder: '123456',
  });
  function submit() {
    const code = codeInput.value.trim();
    if (!code) return authFail('Enter the code from your authenticator app.', 'otp');
    runAuth(async () => {
      const path = p.cancelDeletion ? '/api/auth/cancel-deletion' : '/api/auth/login';
      let user;
      try {
        user = await authPost(path, { email: p.email, password: p.password, code });
      } catch (err) {
        if (err.code === 'deletion_scheduled' && routeSignInStep(err, p.email, p.password)) return;
        throw err;
      }
      const cancelled = p.cancelDeletion;
      await completeSignIn(user);
      if (cancelled) toastSuccess('Deletion cancelled. Your account stays.');
    }, 'otp');
  }
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  focusSoon(codeInput);
  return authShell(
    'Two-step sign-in',
    'Enter the 6-digit code from your authenticator app. Lost your phone? Type one of your recovery codes instead.',
    [
      ...field('Code', codeInput, 'otp'),
      primaryBtn('Verify & sign in', submit),
      h('div', { class: 'gb-login-row' }, authLink('Back to sign in', backToSignin)),
    ]
  );
}

/* ---- Signed in to an account that is waiting to be deleted ---- */
function viewDeletion() {
  const p = state.authPending;
  function cancel() {
    runAuth(async () => {
      let user;
      try {
        user = await authPost('/api/auth/cancel-deletion', { email: p.email, password: p.password });
      } catch (err) {
        // With 2FA on, the cancel needs the code too: same code step, cancel flag carried.
        if (routeSignInStep(err, p.email, p.password, true)) return;
        throw err;
      }
      await completeSignIn(user);
      toastSuccess('Deletion cancelled. Your account stays.');
    });
  }
  return authShell(
    'Scheduled for deletion',
    (p.message || 'This account is scheduled for deletion.') +
      ' Until then nothing is gone — cancel and everything is as you left it.',
    [
      primaryBtn('Cancel deletion', cancel),
      h('div', { class: 'gb-login-row' }, authLink('Back to sign in', backToSignin)),
    ]
  );
}

/* ---- Sign-in ---- */
function viewSignin() {
  const emailInput = h('input', {
    type: 'email',
    class: 'gb-input gb-login-input',
    autocomplete: 'username',
    placeholder: 'you@example.com',
    required: true,
    value: state.authEmail || '',
  });
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    // Not dots: a row of bullets reads as a password the browser already saved.
    placeholder: 'Your password',
    maxlength: 128,
    autocomplete: 'current-password',
  });
  const pwField = passwordField(pwInput);

  function submit() {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    // Silent returns made the button feel dead — always say what's missing.
    if (!email) return authFail('Enter your email to sign in.', 'email');
    if (!emailInput.checkValidity()) return authFail('Enter a valid email address.', 'email');
    if (!password) return authFail('Enter your password to sign in.', 'password');
    runAuth(async () => {
      let user;
      try {
        user = await authPost('/api/auth/login', { email, password });
      } catch (err) {
        if (routeSignInStep(err, email, password)) return;
        // Only the server's own "unverified" 403: any other 403 (a CORS refusal)
        // would open the code screen saying a code was sent when none was.
        if (err.status !== 403 || err.code !== 'email_unverified') throw err;
        // Right password, email never verified: the server just sent a fresh
        // code (AuthService.login), so this is the code screen, not a refusal.
        return setAuthMode('verify', {
          email,
          notice: 'Your email isn’t verified yet, so we sent you a fresh code.',
        });
      }
      await completeSignIn(user);
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

  return authShell('Welcome back', 'Your habits, streaks and reminders are where you left them.', [
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
    autocomplete: 'username',
    placeholder: 'you@example.com',
    required: true,
    value: state.authEmail || '',
  });
  const nameInput = h('input', {
    type: 'text',
    class: 'gb-input gb-login-input',
    placeholder: 'Your name',
    autocomplete: 'name',
    maxlength: 120,
  });
  const pwInput = h('input', {
    type: 'password',
    class: 'gb-input gb-login-input',
    placeholder: 'At least 8 characters',
    maxlength: 128,
    autocomplete: 'new-password',
  });
  // One password field: its reveal eye catches a typo better than typing it
  // twice, and a forgotten one still has reset.
  const pwField = passwordField(pwInput);
  // A hint, not a gate: the server's only rule is 8+ characters. Length and
  // variety are what a guesser pays for, so that is all it counts.
  const pwHint = h('p', { class: 'gb-field-hint', 'aria-live': 'polite' });
  pwInput.addEventListener('input', () => {
    // One message at a time: the field's own error already says it is too short.
    if (state.error && state.errorField === 'password') return void (pwHint.textContent = '');
    const v = pwInput.value;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
    const score = !v
      ? -1
      : v.length < 8
        ? 0
        : 1 + Number(v.length >= 12) + Number(v.length >= 16 || kinds >= 3);
    pwHint.textContent =
      score < 0
        ? ''
        : ['Too short — 8 characters minimum.', 'Weak — longer is stronger.', 'Okay.', 'Strong.'][
            Math.min(score, 3)
          ];
  });

  function submit() {
    const email = emailInput.value.trim();
    const displayName = nameInput.value.trim();
    const password = pwInput.value;
    if (!email) return authFail('Enter your email to create the account.', 'email');
    if (!emailInput.checkValidity()) return authFail('Enter a valid email address.', 'email');
    if (password.length < 8) return authFail('Password must be at least 8 characters.', 'password');
    runAuth(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      // Also the way back for an account that never verified: same password →
      // the server sends a fresh code and answers like a first signup.
      await authPost('/api/auth/signup', { email, password, displayName, timezone: tz });
      // No notice: the verify screen's subtitle already says where the code went.
      setAuthMode('verify', { email });
    }, 'email');
  }

  [emailInput, nameInput, pwInput].forEach((el) =>
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
      pwHint,
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
    if (state.loading) return; // the auto-submit and a tap on Verify are one request
    const otp = (otpInput.value || '').replace(/\D/g, '');
    if (otp.length !== 6) return authFail('Enter the 6-digit code (must be exactly 6 digits).', 'otp');
    runAuth(async () => {
      const user = await authPost('/api/auth/verify', { email: state.authEmail, otp });
      await completeSignIn(user);
    }, 'otp');
  }
  function resend() {
    runAuth(async () => {
      await authPost('/api/auth/resend-verification', { email: state.authEmail });
      state.authNotice = 'New code sent. Any earlier code no longer works.';
      otpInput.value = '';
    });
  }
  otpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  // The sixth digit (typed, pasted or autofilled) sends it. Only a real input
  // event: renderAuth replays a synthetic one to repaint the boxes after a
  // refusal, and answering that would resend a wrong code forever. After an
  // error the code stays in the field; editing it back to six sends again.
  otpInput.addEventListener('input', (e) => {
    if (e.isTrusted && (otpInput.value || '').replace(/\D/g, '').length === 6) submit();
  });
  focusSoon(otpInput);

  // The one place that says where the code went; notices only add what changed.
  return authShell(
    'Verify your email',
    'Enter the 6-digit code we emailed to ' +
      state.authEmail +
      '. Check your spam folder if it isn’t there.',
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
    autocomplete: 'username',
    placeholder: 'you@example.com',
    value: state.authEmail || '',
  });
  function submit() {
    const email = emailInput.value.trim();
    if (!email) return authFail('Enter your email and we’ll send the code there.', 'email');
    if (!emailInput.checkValidity()) return authFail('Enter a valid email address.', 'email');
    runAuth(async () => {
      await authPost('/api/auth/forgot-password', { email });
      setAuthMode('reset', { email });
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
    const password = pwInput.value;
    runAuth(async () => {
      let user;
      try {
        user = await authPost('/api/auth/reset-password', {
          email: state.authEmail,
          otp,
          password,
        });
      } catch (err) {
        // The new password is saved either way; with 2FA on (or a deletion
        // pending) the reset hands over no session, so sign in the usual way.
        if (routeSignInStep(err, state.authEmail, password)) return;
        throw err;
      }
      await completeSignIn(user);
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

  function resend() {
    runAuth(async () => {
      await authPost('/api/auth/forgot-password', { email: state.authEmail });
      state.authNotice = 'New code sent. Any earlier code no longer works.';
      otpInput.value = '';
    });
  }

  // One sentence, worded so it can't say whether the email has an account.
  const sub =
    'If ' + state.authEmail + ' has an account, we emailed it a 6-digit code. Enter it below.';
  return authShell('Set a new password', sub, [
    ...field('6-digit code', otpField, 'otp'),
    ...field('New password', pwField, 'password'),
    ...field('Confirm password', pw2Field, 'confirm'),
    primaryBtn('Reset password', submit),
    h(
      'div',
      { class: 'gb-login-row' },
      authLink('Resend code', resend),
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
    // Both need the password held in authPending; without it (a reload, say) → sign-in.
    case 'totp':
      return state.authPending ? viewTotp() : viewSignin();
    case 'deletion':
      return state.authPending ? viewDeletion() : viewSignin();
    default:
      return viewSignin();
  }
}

/* Sign-outs whose revoke never reached the server (offline): their tokens,
   kept apart from any session, sent on the next 'online' and at boot. */
const REVOKE_KEY = 'gb.revoke.pending';
function queueRevoke(token) {
  try {
    const q = JSON.parse(CacheStorage.getItem(REVOKE_KEY) || '[]');
    if (!q.includes(token)) CacheStorage.setItem(REVOKE_KEY, JSON.stringify([...q, token].slice(-5)));
  } catch (_) {
    /* nothing to keep it in */
  }
}
async function flushRevokes() {
  await CacheStorage.ready();
  let q;
  try {
    q = JSON.parse(CacheStorage.getItem(REVOKE_KEY) || '[]');
  } catch (_) {
    return;
  }
  for (const token of q) {
    try {
      // Any answer settles it: 2xx revoked it, a 401 means it already was.
      await fetch(API_BASE + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    } catch (_) {
      return; // still offline: the rest wait too
    }
    const left = JSON.parse(CacheStorage.getItem(REVOKE_KEY) || '[]').filter((t) => t !== token);
    if (left.length) CacheStorage.setItem(REVOKE_KEY, JSON.stringify(left));
    else CacheStorage.removeItem(REVOKE_KEY);
  }
}

/* Leaving with revokes still queued: one more try, keepalive, so it outlives
   the page. The queue lives in the Cache API, which a WebKit ephemeral store
   (Safari Private Browsing) empties on reload, and the token would stay live.
   Answered ones are dropped by the next flushRevokes (a 401 settles it). */
window.addEventListener('pagehide', () => {
  let q = [];
  try {
    q = JSON.parse(CacheStorage.getItem(REVOKE_KEY) || '[]');
  } catch (_) {
    return;
  }
  q.forEach((token) =>
    fetch(API_BASE + '/api/auth/logout', {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: 'Bearer ' + token },
    }).catch(() => {})
  );
});

function logout() {
  return endSession('logout');
}

/* ---- The one way out of a session ----
   Sign out, a 401 and account deletion all end here. They used to keep three
   hand-written reset lists that had drifted: a 401 left a running focus timer,
   the device alarms, the money cache and the service worker's gb-api-get cache
   for whoever signed in next, and Sign out left the goals, water, food and the
   bell. What a sign-out resets is session.js `freshUserState` (session.test.mjs
   fails on a state field it doesn't classify), the rest is module memory here.
   `reason`: 'logout' | 'expired' | 'deleted'. */
async function endSession(reason) {
  if (!state.user) return;
  // Every sheet goes, by close() not dismiss(): the note editor's dismiss saves,
  // and nothing should save on the way out. Settings' "Sign out" used to leave
  // the sheet up over the sign-in card, the last account's name and email in it.
  closeOverlays({ discard: true });
  popoverCleanup?.();
  syncPanelHistory();
  // Pending writes go before the token does. Not on a 401: that token can't send them.
  if (reason === 'logout') await flushPendingWrites();
  // A dead token can't send them, and the lists they'd restore into are going.
  else undoQueue.clear();
  if (!state.user) return; // a 401 during the flush already ended it
  const token = loadToken();
  // From here on an answer to anything already sent lands nowhere (session.js).
  bumpSession();
  _inflightGets.clear();
  if (reason === 'logout' && token) revokeOnServer(token);
  // On-device alarms (native only; a no-op on the web) were scheduled for this
  // account's reminders, water and habits — they must not ring for the next one.
  // Through push.js's chain, so a sync still running can't re-arm them after.
  cancelAllAlarms().catch(() => {});
  // A running focus timer would finish later and post under the next account.
  import('./timer.js').then((m) => m.resetFocusSession()).catch(() => {});
  disconnectWebSocket();
  const purged = Promise.all([purgeUserCache(reason), deleteUserCaches()]).catch(() => {});
  clearSession();
  clearReminderForm(); // a half-typed reminder in the calendar's kept form
  Object.assign(state, freshUserState(EMPTY_STATE));
  setNotifFirstPage([]); // also drops the last account's unread-past-the-page count
  notifFilter = 'all';
  toastTimers.forEach((t) => clearTimeout(t.handle));
  toastTimers.clear();
  loadedFor = null; // the next sign-in is a first load, not a refresh
  alarmInputsLoaded = false;
  // Another account must not see this one's Insights, nor wait out its throttle.
  insightHistoryAt = 0;
  insightReq = null;
  // Log food's chip rows are this account's foods, not the next one's.
  recentFoods = null;
  favouriteFoods = null;
  pendingWater.clear(); // unsent glasses are this account's (its queue is in its cache)
  shownMoments.clear();
  lastWaterTap = { amount: 0, at: 0 };
  waterRefetch = false;
  // Health readings are someone's health data: never shown to the next account.
  Object.assign(health, { readings: null, loading: false, available: null, syncing: false, syncedAt: null });
  weekGen.bump();
  try {
    sessionStorage.removeItem('gb.authDraft');
  } catch (_) {
    /* ignore */
  }
  if (reason === 'deleted') {
    await purged; // a reload mid-delete would leave the caches behind
    location.reload();
    return;
  }
  if (reason === 'expired') returnToScreen = state.screen; // signing back in returns here, not to Home
  state.screen = 'home';
  state.authMode = 'signin';
  state.authEmail = '';
  state.authNotice = reason === 'expired' ? 'Your session ended. Sign in again.' : '';
  // Drop the hash so the URL doesn't say "#/circle" on the sign-in screen.
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  render();
}

const EMPTY_STATE = {
  wellness: emptyWellness,
  money: emptyMoney,
  streakFreeze: emptyStreakFreeze,
  trends: emptyTrends,
};

/* Step one of a sign-out: send what is queued while the token still works.
   The offline outbox's queue (sends only: the refetch after it would land on
   nobody), capped so an asleep server can't hold Sign out for long; whatever
   didn't go stays queued and purgeUserCache decides. Undoable deletes still
   waiting on their Undo toast commit here too (feat/ov-undo), and the queued
   glasses of water go, all inside the same 4 s. */
async function flushPendingWrites() {
  const sends = (async () => {
    // Deletes still waiting on an Undo toast go first, while the token is good
    // (offline, into the outbox), and are answered before the session goes.
    await undoQueue.flush();
    // No navigator.onLine gate: it can say offline while the network is back
    // (it read false here after an offline spell, and the queued glass never
    // went). A really offline send fails fast and stays queued; the 4 s caps it.
    await CacheStorage.ready();
    await Promise.all([outbox.size() ? outbox.flush(api) : null, flushWaterQueue()]);
  })().catch(() => {});
  await Promise.race([sends, new Promise((r) => setTimeout(r, 4000))]);
}

/* Fire-and-forget; the token is invalidated locally either way. Unsubscribe
   this browser's Web Push endpoint BEFORE the token is revoked, or the server
   keeps pushing this account's reminders to a device that is now someone
   else's. disablePush awaits the service worker before it calls api(), by which
   time clearSession() has dropped the stored token — so it gets a fetch bound
   to the token captured here, and the logout POST waits for it (revoking first
   would 401 the unsubscribe). */
function revokeOnServer(token) {
  const withToken = (path, o = {}) =>
    fetch(API_BASE + path, {
      ...o,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    });
  disablePush(withToken)
    .catch(() => {})
    .then(() => withToken('/api/auth/logout', { method: 'POST' }))
    // No connection: the token is still live on the server. Keep it (alone,
    // not as a session) and revoke it on the next 'online' or boot.
    .catch(() => queueRevoke(token));
}

/* The service worker's runtime caches hold this account's GET responses, keyed
   by URL only: left behind, they answer the next account's requests offline. */
function deleteUserCaches() {
  try {
    if (typeof caches !== 'undefined') return Promise.all(USER_CACHES.map((c) => caches.delete(c)));
  } catch (_) {
    /* no CacheStorage (insecure context) */
  }
  return Promise.resolve();
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
  // achReady means wave 2 has landed. state.weeklyReviews has no cache mirror, so
  // until then "already reviewed this week" always reads false and the nudge
  // appeared on first paint only to vanish when /api/weekly-review answered.
  if (state.loading || !state.achReady || state.screen !== 'home' || !weeklyReviewDue()) {
    return null;
  }
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
/* Going offline or back online only swaps the banner. A render() here rebuilt
   Family and Circle (which own their subtree) and threw away their open panels
   and typed text, and a refresh skips render() for them, so the banner used to
   outlive the reconnect there. */
function syncOfflineBanner() {
  const main = document.getElementById('gb-main');
  const old = main && main.querySelector(':scope > .gb-offline-banner');
  if (old) old.remove();
  const next = offlineBanner();
  if (main && next) main.prepend(next);
}
function handleOnline() {
  if (state.online) return;
  state.online = true;
  syncOfflineBanner();
  // "No connection" next to "Back online" contradicted itself.
  if (state.toasts.some(isConnectionToast)) {
    state.toasts = state.toasts.filter((t) => !isConnectionToast(t));
    dropStaleToastTimers();
  }
  toastSuccess('Back online — syncing your latest data.');
  flushRevokes();
  if (state.user) {
    // The outbox goes after wave 1 (loadData flushes it there too; flush is
    // single-flight), so its refetch can't be answered by wave 1's older GET.
    // Prefs first: in flight, syncUserSession lays them over the /me loadData reads.
    replayUiPrefsOffline();
    loadData().then(flushOutbox);
    flushWaterQueue();
  }
}
function handleOffline() {
  if (!state.online) return;
  state.online = false;
  // The banner says it, and stays while it's true. A toast on top said it twice
  // more, and on a phone the stack covered the open dialog's buttons.
  syncOfflineBanner();
  probeServerSoon();
}

/* The device has a connection but the server gave no answer: ask again until it
   does, since no 'online' event will ever come for that. Truly offline waits
   for that event instead. Any answer is enough (handleOnline does the reload). */
const SERVER_PROBE_MS = 15000;
let serverProbe = 0;
function probeServerSoon() {
  if (serverProbe) return;
  serverProbe = setTimeout(async () => {
    serverProbe = 0;
    if (state.online) return;
    if (navigator.onLine === false) return; // the 'online' event takes it from here
    try {
      const token = loadToken();
      await fetch(API_BASE + '/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      handleOnline();
    } catch (_) {
      probeServerSoon();
    }
  }, SERVER_PROBE_MS);
}

/* The scroll position the last render() restored; a lazy screen re-applies it. */
let lastScrollSnapshot = null;
/* Where each screen was scrolled to when you left it. */
const scrollByScreen = new Map();

/* Meters that change on a tap. render() builds them fresh at the new value, so
   the CSS transition had nothing to run from and they jumped. Each one starts
   from the value it showed last render (keyed by screen + selector + position)
   and is then set to the new one, which the transition animates. */
const TWEENED = [
  ['.gb-score-card svg circle:last-of-type', 'strokeDashoffset'],
  ['.gb-water-fill', 'transform'],
  ['.gb-goal-ms-fill', 'width'],
  ['.gb-goal-progress-fill', 'width'],
];
const lastTween = new Map();
function tweenFromLast() {
  const moves = [];
  for (const [sel, prop] of TWEENED) {
    document.querySelectorAll('.gb-scroll ' + sel).forEach((el, i) => {
      const key = state.screen + ' ' + sel + ' ' + i;
      // The ring sets its offset as an attribute; a style override wins over it.
      const next =
        prop === 'strokeDashoffset' ? el.getAttribute('stroke-dashoffset') + 'px' : el.style[prop];
      const prev = lastTween.get(key);
      lastTween.set(key, next);
      if (prev == null || prev === next) return;
      el.style[prop] = prev;
      moves.push([el, prop, next]);
    });
  }
  if (!moves.length) return;
  // The old values paint one frame, then the new ones are set and transition from
  // them. Was a forced layout (`void offsetWidth`) to commit the start values.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const [el, prop, next] of moves) el.style[prop] = next;
    })
  );
}

/* ---- Command palette + keyboard shortcuts ----
   Ctrl/Cmd+K anywhere, "/" or "?" outside a text field, and the header's search
   button. The UI (palette.js + palette-core.js) loads on first open; only this
   listener and paletteProps() ride in the boot chunk. */
const GO_KEYS = { h: 'home', c: 'calendar', m: 'money', n: 'notes', r: 'report', s: 'settings' };
let palettePromise = null;
function openPalette(help) {
  palettePromise =
    palettePromise ||
    import('./palette.js').catch((err) => {
      palettePromise = null; // a failed fetch (offline) may succeed next time
      throw err;
    });
  palettePromise
    .then((m) => (help ? m.openShortcutHelp(GO_KEYS, SCREEN_LABEL) : m.openPalette(paletteProps())))
    .catch((err) => toastError(err, 'Couldn’t open search. Check your connection?'));
}
function goToScreen(id) {
  if (id === 'settings') openProfileSettings();
  else if (SCREENS[id] && screenEnabled(id)) setScreen(id);
}
/* A note the palette picked ('new' = the composer), taken once by the Notes
   screen's next mount. force: Notes may already be the screen. */
let pendingNoteOpen = null;
function openNoteById(id) {
  pendingNoteOpen = id;
  setScreen('notes', { force: true });
}
/* What the palette searches and does: every item already in state, gated by the
   same featureOn / screenEnabled the nav and Quick add use. */
function paletteProps() {
  const on = featureOn;
  const act = (key, label, icon, run, alt) => ({ key: 'act:' + key, kind: 'action', label, icon, run, alt });
  const dark = state.theme === 'dark';
  const items = [
    act('new-task', 'New task', 'list-todo', () => openAddTask(), ['add task', 'to-do']),
    on('habits') && act('new-habit', 'New habit', 'repeat', openAddHabit, ['add habit']),
    on('calendar') &&
      act('new-reminder', 'New reminder', 'calendar-plus', () => {
        calToday();
        setScreen('calendar');
      }, ['add reminder', 'remind me']),
    on('notes') && act('new-note', 'New note', 'notebook-pen', () => openNoteById('new'), ['add note', 'jot']),
    on('water') && act('water', 'Log water 250 ml', 'droplets', () => quickAddWater(250), ['drink', 'glass']),
    on('focus') && act('focus', 'Start focus', 'timer', () => applyIntent({ type: 'focus' }), ['pomodoro', 'deep work']),
    act('plan', 'Plan my day', 'sparkles', openDailyPlan, ['schedule today']),
    act('theme', dark ? 'Switch to light mode' : 'Switch to dark mode', dark ? 'sun' : 'moon', toggleTheme, [
      'toggle dark mode',
      'theme',
    ]),
    act('settings', 'Open Settings', 'settings', () => openProfileSettings(), ['preferences', 'account']),
    ...Object.keys(SCREENS)
      .filter(screenEnabled)
      .map((id) => ({
        key: 'screen:' + id,
        kind: 'screen',
        label: SCREEN_LABEL[id] || SCREENS[id].headerName(),
        alt: id === 'home' ? [] : [SCREENS[id].headerName()],
        screen: id,
        run: () => setScreen(id),
      })),
    ...(state.tasks || []).map((t) => ({
      key: 'task:' + t.id,
      kind: 'task',
      label: t.title,
      sub: t.done ? 'Done' : t.dueAt ? t.time : '', // not "No due time" on every row
      run: () => openEditTask(t),
    })),
    ...(on('habits') ? state.habits || [] : []).map((hb) => ({
      key: 'habit:' + hb.id,
      kind: 'habit',
      label: hb.name,
      run: () => openHabitForm(hb),
    })),
    ...(on('goals') ? (state.goals || []).flatMap((sec) => sec.goals || []) : []).map((g) => ({
      key: 'goal:' + g.id,
      kind: 'goal',
      label: g.title,
      sub: g.completed ? 'Complete' : '',
      goalId: g.id,
      run: () => setScreen('goals'),
    })),
    ...(on('calendar') ? state.reminders || [] : []).map((r) => ({
      key: 'reminder:' + r.id,
      kind: 'reminder',
      label: r.text,
      reminder: r,
    })),
  ].filter((x) => x && x.label);
  return {
    items,
    // On the reminder's next day (recurrence.js), or its own date: palette.js works out which.
    openDay: (key) => {
      const [y, m, d] = key.split('-').map(Number);
      calGoTo(new Date(y, m - 1, d));
      setScreen('calendar');
    },
    // Notes live on their screen, not in state: the list once, when the palette opens.
    listNotes: on('notes') ? () => api('/api/notes') : null,
    // palette.js shows cached note titles only to the account that cached them.
    userId: state.user && state.user.id,
    openNote: openNoteById,
    // The palette is main's: it always previews, Cancel writes nothing.
    runQuickAdd: (t, b) => runQuickAdd(t, b, { preview: true }),
    recent: (state.user && state.user.uiPrefs && state.user.uiPrefs.paletteRecent) || [],
    saveRecent: (list) => saveUiPrefs({ paletteRecent: list }),
  };
}
let goPending = 0; // when "g" was pressed, for the g-then-letter jumps
document.addEventListener('keydown', (e) => {
  if (!state.user || e.isComposing) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) {
    e.preventDefault();
    const input = document.querySelector('.gb-modal-overlay:not(.is-closing) .gb-palette input');
    if (input) input.focus();
    else openPalette();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const el = document.activeElement;
  const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  if (typing || document.querySelector('[aria-modal="true"]')) {
    goPending = 0;
    return;
  }
  if (goPending && Date.now() - goPending < 1500) {
    goPending = 0;
    if (GO_KEYS[k]) {
      e.preventDefault();
      goToScreen(GO_KEYS[k]);
    }
    return;
  }
  goPending = 0;
  if (k === '/' || k === '?') {
    e.preventDefault();
    openPalette(k === '?');
  } else if (k === 'n') {
    e.preventDefault();
    openAddTask();
  } else if (k === 'g') {
    goPending = Date.now();
  }
});

function render() {
  setAccountZone(state.user && state.user.timezone); // dashboard.js's "today" is the account's
  // A list reloaded mid-window still holds a delete waiting on its Undo toast.
  // ponytail: re-filtered on every paint (a few pending items); a per-load hook if that ever shows.
  undoQueue.reapply();
  const sameScreen = renderedScreen === state.screen;
  // Leaving a screen files its scroll position; coming back to it (back, or its
  // nav tab) restores it instead of starting at the top.
  if (!sameScreen && renderedScreen) {
    const left = captureScrollPosition();
    if (left) scrollByScreen.set(renderedScreen, left);
  }
  const scrollSnapshot = sameScreen
    ? captureScrollPosition()
    : scrollByScreen.get(state.screen) || null;
  const quietRefresh = sameScreen && !!scrollSnapshot;
  const focusKey = sameScreen ? focusLocator(document.activeElement, root) : null;
  const focusWasInApp = root.contains(document.activeElement);
  if (!state.user) {
    // Mount the toast stack alongside the login card so auth errors/notices
    // surface as toasts on the signed-out screen too. (toastStack() is null
    // when empty — filter it out so replaceChildren doesn't get a null.)
    root.replaceChildren(...[loginCard(), toastStack()].filter(Boolean));
    refreshIcons();
    renderedScreen = '';
    document.title = (document.querySelector('.gb-login-title')?.textContent || 'Sign in') + ' · Growth Buddy';
    return;
  }

  // If the active screen belongs to a disabled feature, fall back to home.
  if (!screenEnabled(state.screen)) {
    state.screen = 'home';
    if (window.location.hash) history.replaceState(null, '', '#/home');
  }

  const cfg = SCREENS[state.screen] || SCREENS.home;
  // Per screen, so history and a screen reader can tell them apart. Home's
  // header name is a greeting, not a name.
  document.title =
    (cfg === SCREENS.home ? 'Home' : cfg.headerName()) + ' · Growth Buddy';

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
      onSearch: () => openPalette(),
      onAccount: toggleProfileOpen,
      unreadCount: unreadNotifs(),
      onBell: toggleNotifOpen,
    }),
    // `gb-notif-slot` and `gb-profile-slot` live inside the header's action row
    // (see Header in gb-kit.js) so each panel is positioned by the button that
    // opens it. `repaintOverlays()` fills all three by id, so where they sit in
    // the tree is the header's business, not this one's. Toasts are pinned to
    // the viewport and belong here.
    h('div', { id: 'gb-toast-slot' }, toastStack()),
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
  fillHeaderSlots(); // before refreshIcons and refocus: the panels hold icons and may hold focus
  refreshIcons();
  restoreScrollPosition(scrollSnapshot);
  lastScrollSnapshot = scrollSnapshot;
  renderedScreen = state.screen;
  // replaceChildren() drops focus on <body>, so after any save the next Tab
  // started from the top of the page. Same screen: the same control again.
  // A real screen change: the main region, so a reader hears the new screen.
  if (focusKey) refocus(focusKey, root);
  else if (!sameScreen && focusWasInApp)
    document.getElementById('gb-main')?.focus({ preventScroll: true });
  tweenFromLast();
  syncHeaderExpanded();
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
  syncPanelBackEntry();
  // The More sheet too: it had a backdrop to tap but nothing for Escape.
  if (!state.notifOpen && !state.profileOpen && !state.moreOpen) return;
  function cleanup() {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    popoverCleanup = null;
  }
  function closePopovers() {
    cleanup();
    state.notifOpen = false;
    state.profileOpen = false;
    state.moreOpen = false;
    repaintOverlays();
  }
  function onDocDown(ev) {
    // The nav owns its own taps (backdrop, More, a destination); closing on
    // mousedown would rebuild it before the click landed.
    const pop = ev.target.closest(
      '.gb-notif-pop, .gb-profile-pop, .gb-bell, .gb-avatar, .gb-nav-wrap'
    );
    if (pop) return; // click inside the popover or its trigger
    closePopovers();
    swallowNextClick();
  }
  // The tap that dismisses a panel is only a dismiss: without this its click
  // still landed on whatever card was under it (Plan my day, the weekly review).
  function swallowNextClick() {
    const eat = (e) => {
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    const done = () => document.removeEventListener('click', eat, true);
    document.addEventListener('click', eat, true);
    // A press that drags off fires no click; don't eat the next real one.
    document.addEventListener('mouseup', () => setTimeout(done, 0), { once: true, capture: true });
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
// Not window.CacheStorage: that name is the browser's own Cache API interface.
if (CacheStorage.init) {
  CacheStorage.init()
    .then((hydrated) => {
      // Large client-only data (e.g. wellness photo history) may have loaded
      // from the Cache API asynchronously — re-read it and repaint if so.
      // The custom chime is Cache-API-only (too big for a cookie), so it can
      // only be read once this resolves — whether or not anything repaints.
      loadCustomChime();
      // A reload with a stored session never passes through syncUserSession,
      // so without this a device already signed in never saw a sound added on
      // another one. Once per load either way (see customChimePulled).
      if (state.user) pullCustomChime();
      // A focus session stored before a reload or a killed app: resumed, or
      // counted once if it ended meanwhile. timer.js only loads when one exists.
      if (state.user && CacheStorage.getItem('gb.focusSession')) {
        import('./timer.js')
          .then((m) => m.resumeFocusSession(focusProps()))
          // A session that fails to resume is focus time that never gets counted.
          .catch((err) => console.warn('[focus] resume failed:', err));
      }
      if (hydrated && state.user) {
        // The session cookie is slim (cache-storage.js cookieValue): the profile
        // fields it leaves out come from the Cache API copy, without overwriting
        // anything /api/auth/me may already have refreshed.
        const full = loadSession();
        if (full) Object.keys(full).forEach((k) => k in state.user || (state.user[k] = full[k]));
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
    .catch((err) => {
      console.warn('CacheStorage init failed:', err);
      markCustomChimesLoaded(); // nothing local to merge, but don't stall the pull
    });
} else {
  markCustomChimesLoaded();
}
initA11y();
initPullToRefresh();
if (navigator.onLine) flushRevokes(); // a sign-out made offline last time
/* Coming back to the app after it was backgrounded. The socket may have been
   suspended without ever firing a disconnect, so `onConnect` never runs and the
   bell is quietly stale. Ask the server directly. */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (state.user) {
    // Away over a minute (a backgrounded phone, another tab): ticks made on another
    // device were still shown undone, and tapping one again un-did it (HOS-6).
    if (hiddenAt && Date.now() - hiddenAt > 60_000) refreshOutboxStores(new Set(['task', 'habit']));
    flushQueued(); // back from the background: the connection may be too
    refreshNotifications();
    syncDeviceTimezone(); // reopened after a flight
    refreshDayIfStale();
    syncHealthFromPhone(); // walked since the app was last open
    autoTickHealthHabits();
    // A notification button did something while the app was away: show it.
    takeNativeChanges().then((changed) => changed && state.user && loadData());
    autoLogSleep(); // woke up and opened the app
    loadPhoneNight(); // the night to offer, when it didn't log itself
  }
});

/* Opened the next morning from the background: water and food still showed
   yesterday's totals (and a tap added to them) until something else reloaded.
   Each summary carries its own date, so a stale one is a cheap check. */
function refreshDayIfStale() {
  const today = todayKey();
  const stale = (s) => s && s.date && s.date !== today;
  if (!stale(state.water) && !stale(state.food)) return;
  Promise.all([
    stale(state.water) ? api('/api/water').catch(() => null) : null,
    stale(state.food) ? api('/api/food').catch(() => null) : null,
  ]).then(([water, food]) => {
    if (water) state.water = withPendingWater(water);
    if (food) {
      state.food = food;
      cacheFoodSummary(food);
    }
    if (water || food) {
      invalidateWeek(water && food ? 'both' : water ? 'water' : 'food');
      render();
    }
  });
}
applyTheme(state.theme);
followSystemTheme();
applyPremium(state.premium, true);
applyTextScale(state.textScale);
if (state.user) {
  // Restore the screen from the URL fragment, so refreshing on /circle stays there.
  state.screen = screenFromHash();
  setNativeAuth(loadToken(), API_BASE); // a session from before the plugin shipped
  loadData();
} else {
  // Opened a link (#/money) while signed out: go there once signed in.
  returnToScreen = screenFromHash();
}
// Re-push the money blob every 5 minutes in case a save was lost to a dropped
// connection, or to a 5xx while still online (no 'online' event ever fires for
// that). Armed whether or not this boot is signed in: it used to be armed only
// then, so anyone who signed in during the session never got it. Wellness rode
// along here too, PUTting to an endpoint that has never existed — a failure on
// a timer, forever. Sleep and mood are saved by their own POSTs.
setInterval(
  () => {
    if (!state.user || !navigator.onLine) return;
    if (state.money && moneyDirty()) persistMoney();
  },
  5 * 60 * 1000
);
// Resolve the device model before anything signs in — the label rides along on
// the request that creates the session.
initNative();
// A link that opened the app (or arrived while it ran): its hash is the route,
// and the hashchange handler above routes it, signed in or not.
onDeepLink((url) => {
  const hash = deepLinkHash(url);
  if (hash) window.location.hash = hash;
});
// Signed in, loadData() above has already painted the loading screen; a second
// render here rebuilt the same tree before any data had arrived.
if (!state.user) render();
// The splash is held open by launchAutoHide:false — nothing else drops it.
hideNativeSplash();
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
  // money.js is a lazy chunk now; load it on DEV boot so its _demo() (and
  // share-card's, which rides along) still runs without opening Money.
  import('./money.js').catch(() => {}); // not money-screen.js: no CSS, so a dev boot matches a real one
}
