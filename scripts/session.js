/* =====================================================================
   Growth Buddy — the session's pure parts. app.js `endSession` is the one way
   out of a session (Sign out, a 401, account deletion); this is what it
   resets, the generation that makes a late answer for an ended session land
   nowhere, and the phone app's last-good wave-1 snapshot. No DOM, so
   `node scripts/session.test.mjs` can check them. That test also reads app.js
   and fails on a `state` field that is in neither list below: logout and the
   401 path used to keep two hand-written reset lists, and they drifted.
   ===================================================================== */

/* ---- Session generation ----
   Bumped by every sign-out. api() notes it before a request goes out and,
   when the answer lands under a newer one, rejects with sessionEndedError()
   instead: a wave 1 still in flight at sign-out no longer writes the old
   account's tasks into `state`, sets `loadedFor` back, or caches its money
   under the guest key. Rejected rather than left pending, so every `finally`
   (in-flight flags, the money save queue) still runs. */
let gen = 0;
export const sessionGen = () => gen;
export const bumpSession = () => ++gen;
export const isStaleSession = (g) => g !== gen;

/* The message of that rejection. pushToast drops it: there is nobody left to
   tell, and a toast on the sign-in card would only confuse whoever is next. */
export const SESSION_ENDED = 'That session has ended.';
export const sessionEndedError = () =>
  Object.assign(new Error(SESSION_ENDED), { sessionEnded: true });

/* ---- What a sign-out resets ----
   Every per-account `state` field, at its empty value. `empty` holds the
   factories whose shape lives in app.js / money-core.js (wellness, money,
   streakFreeze, trends). A new field belongs here unless it is device-level. */
export function freshUserState(empty) {
  return {
    user: null,
    tasks: [],
    habits: [],
    goals: [],
    reminders: [],
    wellness: empty.wellness(),
    goalProgress: {},
    weeklyReviews: {},
    money: empty.money(),
    streakFreeze: empty.streakFreeze(),
    freezeTokens: 0,
    trends: empty.trends(),
    water: null,
    food: null,
    quote: null,
    score: 0,
    calendarFoodByDate: {},
    calendarFoodErrorByDate: {},
    calendarFoodLoadingFor: '',
    notifications: [],
    notifOpen: false,
    profileOpen: false,
    moreOpen: false,
    toasts: [],
    insightHistory: null,
    waterUsualHours: null,
    foodWeek: null,
    waterWeek: null,
    dietCheck: null,
    weekError: '',
    achReady: false,
    error: '',
    errorField: '',
    loading: false,
    authPending: null,
    // This phone's night, read for the last account (health sync).
    phoneNight: null,
    // Unknown until GET /api/family answers for this account (Quick add's Groceries).
    inFamily: undefined,
  };
}

/* Device-level fields a sign-out keeps, or sets itself (screen, the auth
   card's mode / email / notice depend on why the session ended). */
export const DEVICE_STATE = [
  'theme',
  'premium',
  'textScale',
  'screen',
  'reportRange',
  'calYear',
  'calMonth',
  'selectedDate',
  'online',
  'authMode',
  'authEmail',
  'authNotice',
];

/* Cache API caches that hold this account's responses. The service worker's
   NetworkFirst cache is keyed by URL only (not the Authorization header), so
   left behind it serves one account's tasks to the next one offline. */
export const USER_CACHES = ['gb-api-get'];

/* A CacheStorage key of this account's: gb.<thing>.<uid>[.<more>]. `keep` is
   the money pending queue that still holds writes (the only copy there is). */
export function isUserKey(key, uid, keep) {
  if (!uid || key === keep) return false;
  const id = String(uid);
  return key.endsWith('.' + id) || key.includes('.' + id + '.');
}

/* ---- The phone app's boot snapshot ----
   On the web the service worker answers wave 1 from gb-api-get when offline.
   The app has no worker, so a cold start with no connection used to land on
   the crash card. app.js keeps the last good wave 1 (plus goals, which are
   not cache-backed either) under gb.boot.<uid> in the app only, and paints from
   it when the first load gets no response at all. Under the user's id, so
   isUserKey() matches it and every sign-out removes it. */
export const bootKey = (uid) => 'gb.boot.' + uid;
const BOOT_LISTS = ['tasks', 'habits', 'reminders', 'goals'];

export function bootSnapshot(s) {
  return JSON.stringify({
    tasks: s.tasks,
    habits: s.habits,
    reminders: s.reminders,
    goals: s.goals,
    score: s.score,
    water: s.water,
  });
}

/* The stored snapshot as state fields, or null when there is none worth painting. */
export function readBootSnapshot(raw) {
  let snap;
  try {
    snap = raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
  if (!snap || !BOOT_LISTS.every((k) => Array.isArray(snap[k]))) return null;
  return {
    tasks: snap.tasks,
    habits: snap.habits,
    reminders: snap.reminders,
    goals: snap.goals,
    score: typeof snap.score === 'number' ? snap.score : 0,
    water: snap.water && typeof snap.water === 'object' ? snap.water : null,
  };
}

/* Paint from the snapshot only in the app, and only for "no response at all":
   a 5xx is the server answering (the crash card's retry is right there), a
   401 already signed out, and a stale answer belongs to nobody. */
export const bootFromSnapshot = (err, native) =>
  !!native && !!err && !err.status && !err.sessionEnded;
