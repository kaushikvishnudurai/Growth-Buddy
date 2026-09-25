/* =====================================================================
   Growth Buddy — Web Push client
   Enable/disable browser push. Fetches the VAPID public key from the server,
   asks the browser for permission, subscribes via the active service worker,
   and registers the subscription with the backend. Degrades quietly when push
   is unsupported or the server has no VAPID keys configured.
   Inside the Capacitor app none of that exists — an Android WebView has no
   PushManager — so the same three calls route to on-device local notifications
   instead. That path raises its permission sheet as Growth Buddy rather than
   as Chrome, which is the whole point of shipping a native shell.

   Timed reminders take the same fork. On the web the server pushes them
   (ReminderDeliveryScheduler -> Web Push); in the app there is nothing to push
   TO — an Android WebView has no PushManager, so it can never register a
   subscription — which is why reminders arrived in the in-app bell and nowhere
   else. `syncReminderNotifications` queues them on the device instead, off the
   same recurrence rules the calendar draws from.
   ===================================================================== */

import {
  localNotificationsAvailable,
  localNotificationPermission,
  requestLocalNotifications,
  scheduleLocalNotification,
  scheduleLocalNotifications,
  cancelPendingLocalNotifications,
  SILENT_CHANNEL,
} from './native.js';
import { occursOn } from './recurrence.js';
import { SOUNDS } from './chime.js';

export function pushSupported() {
  if (localNotificationsAvailable()) return true;
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Is this browser already subscribed? */
export async function pushSubscribed() {
  if (localNotificationsAvailable()) {
    return (await localNotificationPermission()) === 'granted';
  }
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    return !!(await reg.pushManager.getSubscription());
  } catch (_) {
    return false;
  }
}

/**
 * Turn push on. `api` is the app's fetch wrapper. Returns a status string:
 * 'ok' | 'unsupported' | 'unconfigured' | 'denied' | 'error'.
 */
export async function enablePush(api) {
  if (localNotificationsAvailable()) {
    const perm = await requestLocalNotifications();
    return perm === 'granted' ? 'ok' : perm === 'unsupported' ? 'unsupported' : 'denied';
  }
  if (!pushSupported()) return 'unsupported';
  let info;
  try {
    info = await api('/api/push/public-key');
  } catch (_) {
    return 'error';
  }
  if (!info || !info.configured || !info.publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey),
      });
    }
    const json = sub.toJSON();
    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys && json.keys.p256dh,
        auth: json.keys && json.keys.auth,
      }),
    });
    return 'ok';
  } catch (_) {
    return 'error';
  }
}

/** Turn push off: unsubscribe locally and tell the server to forget the endpoint. */
export async function disablePush(api) {
  // Android owns the switch once permission is granted; an app cannot revoke its
  // own. The caller tells the user where the system toggle lives.
  if (localNotificationsAvailable()) return;
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }).catch(() => {});
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Fire a notification right now, to prove the wiring works. On native this is a
 * local notification; on the web the server pushes it, so the caller keeps using
 * /api/push/test there.
 */
export async function pushTestLocal(sound) {
  return scheduleLocalNotification({
    id: 1,
    title: 'Growth Buddy',
    body: 'Notifications are working. See you at your next reminder.',
    // Same file a real reminder will use, so the test actually tests the sound.
    sound: soundFile(sound),
    // ...and the same channel, so a test on 'Silent' is silent too. It used to
    // ignore the tone entirely, which made the button prove the opposite of
    // what was happening: it rang while every real alarm was being dropped.
    channelId: sound === 'off' ? SILENT_CHANNEL : undefined,
  });
}

/* ---- The device's alarm queue --------------------------------------------

   Everything below is the app-only half of notifications: the server can only
   deliver to a Web Push subscription and the WebView can never register one,
   so timed reminders and water nudges are queued on the device instead.

   How far ahead to queue. Android will not hold an unbounded number of alarms
   and the set is rebuilt on every launch and every change, so two weeks is
   runway nobody reaches. Water gets a shorter one on purpose: at a nudge every
   two hours it would otherwise fill the whole queue and push real reminders off
   the end.
   ponytail: an app left unopened for longer than the horizon goes quiet. The
   fix is a push or a periodic background task; neither is worth it while
   opening the app re-arms everything. */
const HORIZON_DAYS = 14;
const WATER_HORIZON_DAYS = 3;
const MAX_QUEUED = 100;

/** Defaults for the water nudge, and the shape `ui_prefs.water` is stored in. */
export const WATER_DEFAULTS = { on: false, everyMins: 120, from: '09:00', to: '21:00' };

function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 'HH:MM' as minutes past local midnight. */
function minuteOfDay(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

function atOn(day, minutes) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, 0, 0);
}

/**
 * Expand reminder definitions into the notifications they'd fire.
 *
 * Pure, and exported for `push.test.mjs` — the awkward parts (an occurrence
 * earlier today has already passed, an all-day reminder has no time to fire at,
 * recurrence and skips) are exactly the parts that can't be checked on a phone.
 */
export function upcomingReminderAlarms(reminders, now, days = HORIZON_DAYS) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = dayKey(day);
    for (const rem of reminders || []) {
      // No time means an all-day note on the calendar. There is no moment to
      // ring at, and 00:00 would ring in the middle of the night.
      if (!rem || !rem.time || !occursOn(rem, key)) continue;
      const [hh, mm] = String(rem.time).split(':').map(Number);
      // A time that doesn't parse would make an Invalid Date, and every check
      // below passes on NaN — the alarm would be queued with a NaN id and the
      // whole batch rejected. Skip it instead.
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const at = atOn(day, hh * 60 + mm);
      if (at.getTime() <= now.getTime()) continue;
      // A reminder can carry its own chime key; null/absent means the user's
      // default, which only `upcomingAlarms` below knows.
      out.push({ title: 'Growth Buddy', body: rem.text, at, sound: rem.sound || null });
    }
  }
  return out;
}

/**
 * The water nudge: a fixed drumbeat between two local times, every day. Not a
 * calendar entry — there is nothing to anchor, repeat or skip, which is why it
 * doesn't go through `recurrence.js`.
 */
export function upcomingWaterAlarms(prefs, now, days = WATER_HORIZON_DAYS) {
  const p = Object.assign({}, WATER_DEFAULTS, prefs || {});
  if (!p.on) return [];
  // A 5-minute drumbeat is a fault, not a preference, and it would fill the
  // whole queue in an afternoon.
  const every = Math.max(30, Number(p.everyMins) || WATER_DEFAULTS.everyMins);
  const from = minuteOfDay(p.from, 9 * 60);
  const to = minuteOfDay(p.to, 21 * 60);
  // An inverted or empty window means "no waking hours" — silence beats
  // guessing, and it's what an unfinished edit in the picker looks like.
  if (to <= from) return [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (let m = from; m <= to; m += every) {
      const at = atOn(day, m);
      if (at.getTime() <= now.getTime()) continue;
      out.push({ title: 'Time for water', body: 'A glass now keeps today\u2019s goal in reach.', at });
    }
  }
  return out;
}

/**
 * One alarm a day for a habit with a reminder time set, skipped for a habit
 * already checked in today. Daily only, regardless of the habit's own
 * cadence — the UI calls this field "Daily reminder," and there is no
 * per-day-of-week input to honor anything else.
 */
export function upcomingHabitAlarms(habits, now, days = HORIZON_DAYS) {
  const out = [];
  for (const habit of habits || []) {
    if (!habit || !habit.reminderTime) continue;
    const [hh, mm] = String(habit.reminderTime).split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    for (let i = 0; i < days; i++) {
      // doneToday only describes today (i === 0) — a habit checked in this
      // morning still needs tomorrow's alarm, so the skip can't cover the
      // whole horizon.
      if (i === 0 && habit.doneToday) continue;
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const at = atOn(day, hh * 60 + mm);
      if (at.getTime() <= now.getTime()) continue;
      out.push({ title: 'Growth Buddy', body: habit.name, at, sound: habit.sound || null });
    }
  }
  return out;
}

/* Only the five synthesised chimes have a rendered file. 'off', an unknown key,
   and the user's own upload (which lives as a data URL in CacheStorage, not in
   the bundle, so Android has nothing to point a channel at) all fall through to
   the phone's own notification sound. */
function soundFile(key) {
  return SOUNDS[key] ? 'gb-' + key + '.wav' : undefined;
}

/**
 * The whole queue, in firing order. `sound` is a chime key from `chime.js`;
 * the matching `public/gb-<key>.wav` rides in the web bundle and the plugin
 * resolves it out of the app's assets and makes the per-sound Android channel
 * itself — which is why a custom notification sound needs no native code here.
 */
export function upcomingAlarms({ reminders, water, habits, sound } = {}, now = new Date()) {
  const queue = upcomingReminderAlarms(reminders, now)
    .concat(upcomingWaterAlarms(water, now))
    .concat(upcomingHabitAlarms(habits, now));
  queue.sort((a, b) => a.at - b.at);
  // Ids come from the minute a notification fires in, not its place in the
  // queue. A counter looked safe — the queue is cancelled whole and rebuilt —
  // but cancelling leaves notifications already sitting in the phone's shade
  // alone, and the rebuilt batch handed their ids straight back to the next
  // alarms. Android replaces a notification when one with the same id arrives,
  // so deleting a reminder silently wiped delivered ones off the lock screen.
  // Everything queued is in the future and everything delivered is in the past,
  // and a later minute is always a bigger number, so the two can't collide.
  const used = new Set();
  return queue.slice(0, MAX_QUEUED).map((n) => {
    // 4 bits of room for alarms sharing a minute, then step forward until the
    // id is free. Clamping the 17th into the 16th slot instead would have let
    // one reminder quietly overwrite another. Every id still sits at or above
    // its own minute, which is the property that keeps it clear of anything
    // already delivered — and inside a signed 32-bit int until the year 2225.
    let id = Math.floor(n.at.getTime() / 60000) * 16;
    while (used.has(id)) id++;
    used.add(id);
    // Each reminder's own tone if it set one, the user's default otherwise.
    // The water nudge never sets one, so it always follows the default.
    const key = n.sound || sound;
    return Object.assign(n, {
      id,
      sound: soundFile(key),
      // 'Silent' means a silent notification, not no notification. Android
      // takes the sound from the CHANNEL, so a channel built without one keeps
      // the system default — which made the Silent tone ring the phone's own
      // sound, the loudest possible reading of it. The old answer was to queue
      // nothing at all, and that cost the user the reminder along with the
      // sound: it arrived in the in-app bell and on WhatsApp, and never on the
      // phone. A channel at IMPORTANCE_LOW shows in the shade and never makes
      // a sound, which is what the picker has always promised.
      channelId: key === 'off' ? SILENT_CHANNEL : undefined,
    });
  });
}

/**
 * Re-arm this device. No-op on the web (the server pushes there) and when the
 * user hasn't granted notifications. Returns how many are queued.
 */
export async function syncDeviceAlarms(opts) {
  if (!localNotificationsAvailable()) return 0;
  if ((await localNotificationPermission()) !== 'granted') return 0;
  const queue = upcomingAlarms(opts, new Date());
  // Cancel first: an edited or deleted reminder must not keep its old alarm,
  // and rebuilding the whole set is cheaper to reason about than diffing it.
  await cancelPendingLocalNotifications();
  return (await scheduleLocalNotifications(queue)) ? queue.length : 0;
}
