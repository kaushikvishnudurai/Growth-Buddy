/* =====================================================================
   Growth Buddy — native shell helpers
   Everything that only means something inside the Capacitor app. Plugins are
   reached through the bridge rather than imported: the plugin packages live in
   ../Growth-Buddy-Mobile, so an import would break the web build. `nativePlugin`
   below is the single door in — app.js's speech-recognition call uses it too.
   ===================================================================== */

export function isNative() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : cap.isNative));
}

/**
 * The public web address of the app, no trailing slash: what a link meant for
 * someone else (a Circle invite, the privacy policy, "download it on the
 * website") must point at. In a browser that is this page's origin. In the
 * phone app the page is https://localhost, which is the phone itself, so it is
 * the API base instead: the backend serves the same SPA, and a native bundle
 * cannot be built without VITE_API_BASE (app.js resolveApiBase).
 */
export function publicSiteUrl() {
  const base = (import.meta.env && import.meta.env.VITE_API_BASE) || '';
  if (isNative() && /^https?:\/\//.test(base)) return base.replace(/\/+$/, '');
  return typeof location !== 'undefined' ? location.origin : '';
}

/**
 * Reach a native plugin, or null off-device.
 *
 * `Capacitor.Plugins` is only ever filled in by `registerPlugin()`, which lives
 * inside the plugin's own JS package — and those packages are in
 * ../Growth-Buddy-Mobile, not in this bundle, so importing them would break the
 * web build. In the shipped app `Capacitor.Plugins` is therefore always empty
 * and every lookup here returned null: no splash control, no device name, and
 * "this browser doesn't support push notifications" on a phone. The bridge's own
 * `nativePromise(plugin, method, options)` reaches the same native class without
 * any of that JS, so proxy onto it.
 * Promise-style methods only. The one listener the app needs (a tap on a
 * notification's button) goes through `onLocalNotificationAction` below, which
 * calls `cap.nativeCallback` itself.
 */
export function nativePlugin(name) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return null;
  const registered = cap.Plugins && cap.Plugins[name];
  if (registered) return registered;
  if (typeof cap.nativePromise !== 'function') return null;
  // The native side lists every plugin it was built with (both platforms set
  // PluginHeaders before the page runs). One that isn't listed is not in this
  // binary — the iOS build has no speech plugin, no build has Health — and a
  // proxy for it is a button that shows and then always fails.
  const headers = cap.PluginHeaders;
  if (Array.isArray(headers) && !headers.some((p) => p && p.name === name)) return null;
  return new Proxy(
    {},
    {
      get(_, method) {
        // Never look thenable: these proxies get truthiness-checked and stored,
        // and an accidental `await` on one would hang forever.
        if (typeof method !== 'string' || method === 'then') return undefined;
        return (options) => cap.nativePromise(name, method, options || {});
      },
    }
  );
}

/**
 * Every file the app hands the user (story card PNG, data export, .ics, CSV)
 * goes out through here.
 *
 * In the app a `<a download href=blob:>` is silently dropped: the Capacitor
 * WebView registers no download handler, so the file went nowhere while the
 * caller toasted "downloading". There the bytes are written to the cache dir
 * (@capacitor/filesystem) and offered through the OS share sheet
 * (@capacitor/share), which is where "save to Files", Drive, mail and
 * Instagram all live. On the web an image is offered to the Web Share sheet
 * where it takes files (Instagram's story is in there); everything else
 * downloads as before.
 *
 * @returns {Promise<'shared'|'saved'>} `shared` = a share sheet took it (a
 *   dismissed sheet counts, the platform does not say otherwise); `saved` = a
 *   browser download started. Rejects with a user-facing message when the
 *   native path fails, so no caller can claim a success that did not happen.
 */
export async function saveFile(data, filename, mime, title = 'Growth Buddy') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (isNative()) {
    const FS = nativePlugin('Filesystem');
    const Share = nativePlugin('Share');
    let uri;
    try {
      // 'CACHE' is Directory.Cache; without an encoding, data is read as base64.
      // ponytail: the cache file is left for the OS to evict; the next save of
      // the same name overwrites it.
      const res = await FS.writeFile({ path: filename, data: await blobToBase64(blob), directory: 'CACHE' });
      uri = res && res.uri;
    } catch (_) {
      uri = null;
    }
    if (!uri) throw new Error('Could not save the file on this phone. Try again.');
    try {
      await Share.share({ title, files: [uri] });
    } catch (err) {
      // A dismissed sheet rejects with "Share canceled": still a share offered.
      if (!/cancel/i.test(String((err && err.message) || err || ''))) {
        throw new Error('Could not open the share sheet. Try again.');
      }
    }
    return 'shared';
  }
  if (/^image\//.test(mime) && typeof File === 'function' && navigator.canShare) {
    // canShare({files}) is the only honest test: desktop Firefox has share() but rejects files.
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (err) {
        // AbortError = the user closed the sheet; anything else downloads instead.
        if (err && err.name === 'AbortError') return 'shared';
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** A blob -> its bytes as bare base64 (no data: prefix), for Filesystem.writeFile. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

let deviceLabel = null;

/**
 * "Growth Buddy on SM-S918B", or null in a browser. Sent as X-GB-Device so the
 * signed-in-devices list can name the handset — a browser User-Agent can't tell
 * the server that any more, Chrome redacts Android down to a literal "K".
 */
export function deviceLabelHeader() {
  return deviceLabel;
}

/** Resolve the device label once at boot. Safe to call on the web — no-ops. */
export async function initNative() {
  if (!isNative() || deviceLabel) return;
  // The splash backstop is not here: this runs at the end of app.js, so a throw
  // earlier in it never armed one. public/global-shim.js arms it before app.js.
  // Not awaited: housekeeping, never worth holding boot for.
  pruneStaleChannels();
  const Device = nativePlugin('Device');
  let model = '';
  if (Device) {
    try {
      const info = await Device.getInfo();
      model = info && info.model ? String(info.model) : '';
    } catch (_) {
      // Fall through to the unqualified label.
    }
  }
  deviceLabel = model ? `Growth Buddy on ${model}` : 'Growth Buddy';
}

/* ---- Local notifications -------------------------------------------------
   Reminders are scheduled on-device, so they need no VAPID keys, no Firebase
   project and no network. The permission sheet is raised by the app itself,
   which is why it says "Growth Buddy" and not "Chrome".
   ponytail: local only. Server-initiated nudges (a mentor pings you while the
   app is closed) need FCM + @capacitor/push-notifications — separate job. */

/* Android takes everything about how a notification behaves from its CHANNEL,
   not from the notification: the sound, whether it vibrates, and whether it
   appears on screen at all. All of it is frozen the moment the channel is
   created — an app cannot raise any of it afterwards, only the user can, in
   Settings, and a deleted channel comes back with its old settings intact.

   Left alone, @capacitor/local-notifications invents a channel per sound file
   (`sound_<name>`) at IMPORTANCE_DEFAULT. That rings and stops there: at
   importance 3 Android plays the sound and slides the notification straight
   into the shade without ever putting a banner on screen, so the phone makes a
   noise and nothing appears — indistinguishable from a bug. Only IMPORTANCE_HIGH
   (4) banners.

   So we create the channels ourselves and always name one on the notification,
   which is also what stops the plugin inventing its own. A channel's sound can
   only ever be a res/raw resource — never a web asset — which is why
   gen-chimes.mjs writes the wavs there too, under names Android will accept.

   iOS and the web have no channels at all; createChannel fails there and the
   notification posts with the platform's own behaviour, which is already right.

   Because Android freezes them, changing a channel's importance or sound
   later needs a NEW id. That is what CHANNEL_VERSION is for: bump it, and
   every id gains a `-v<N>` suffix (version 1 is the plain ids that already
   exist on phones) while pruneStaleChannels, run from initNative, deletes our
   `gb-` channels from any other version so Settings doesn't list both.
   ponytail: one version for every channel. A change to one tone re-creates
   all of them — which also resets any per-channel tweak the user made in
   Settings; per-channel versions if that ever matters. */
export const CHANNEL_VERSION = 1;

/** 'gb-tone-chime' -> the id for the current version ('gb-tone-chime-v2' at 2). */
export function versionedChannel(base, version = CHANNEL_VERSION) {
  return version === 1 ? base : base + '-v' + version;
}

/** Whether one of OUR channels belongs to another version. Pure, for push.test.mjs. */
export function isStaleChannel(id, version = CHANNEL_VERSION) {
  if (typeof id !== 'string' || !id.startsWith('gb-')) return false;
  const m = /-v(\d+)$/.exec(id);
  return (m ? Number(m[1]) : 1) !== version;
}

export const SILENT_CHANNEL = versionedChannel('gb-silent');

/* Delete our channels from earlier (or later) versions. Promise-style
   listChannels/deleteChannel only; iOS and the web have no channels, and a
   rejection there is the expected answer. Never touches a channel we didn't
   name (no `gb-` prefix). */
async function pruneStaleChannels() {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return;
  try {
    const res = await LN.listChannels();
    const stale = ((res && res.channels) || []).map((c) => c && c.id).filter((id) => isStaleChannel(id));
    for (const id of stale) await LN.deleteChannel({ id });
  } catch (_) {
    /* no channels on this platform */
  }
}

/* createChannel is idempotent but not free, and this runs per batch. A failed
   call is marked done too: failure means the platform has no channels, and
   retrying that once per schedule would cost a round trip forever. */
const channelsReady = new Map(); // id -> whether it can be posted to

/** 'gb-tone-chime' -> 'Chime', for the row the user sees in Settings. */
function toneName(id) {
  const key = id.replace(/^gb-tone-/, '').replace(/-v\d+$/, '');
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/* Resolves to whether the channel can be posted to. Only the user's own sound
   can say no: its channel comes from CustomNotificationSoundPlugin, and an APK
   built before that plugin (or a sound it refuses) has no such channel, and a
   notification naming a channel that doesn't exist is dropped by Android
   without a word. The caller moves it to the default channel instead. */
async function ensureChannel(LN, id, sound, custom) {
  if (!id) return true;
  if (channelsReady.has(id)) return channelsReady.get(id);
  if (custom) {
    const CS = nativePlugin('CustomNotificationSound');
    let ok = false;
    try {
      if (CS) {
        await CS.ensureChannel({ id, name: 'Reminders \u00b7 ' + custom.name, dataUrl: custom.url });
        ok = true;
      }
    } catch (_) {
      /* an older APK, or a sound it could not use */
    }
    channelsReady.set(id, ok);
    return ok;
  }
  // An own sound's channel with no bytes must not be built as a plain one: it
  // would exist with the phone's default sound, and the plugin can never fix a
  // channel that already exists. Not cached, so a call with the bytes still builds it.
  if (id.startsWith('gb-tone-custom-')) return false;
  channelsReady.set(id, true);
  const silent = id === SILENT_CHANNEL;
  try {
    await LN.createChannel({
      id,
      // Every tone is its own row in the phone's notification settings, so it
      // needs a name the user can tell from the other six.
      name: silent ? 'Silent reminders' : 'Reminders \u00b7 ' + toneName(id),
      // 2 = LOW: in the shade, never a sound, whatever it points at.
      // 4 = HIGH: the banner. 3 is the plugin's default and the broken middle.
      importance: silent ? 2 : 4,
      // Left off the silent channel deliberately: a channel with no sound takes
      // the system default, and it is importance 2 that actually keeps it quiet.
      sound: silent ? undefined : sound,
      vibration: !silent,
    });
  } catch (_) {
    /* no channels on this platform */
  }
  return true;
}

/** Drop the channels of the user's own sounds that are gone. `keep` is the ids still in use. */
export async function pruneCustomChannels(keep) {
  const CS = nativePlugin('CustomNotificationSound');
  if (!CS) return;
  try {
    await CS.prune({ keep });
    // A sound deleted and then restored must be rebuilt, not trusted to the cache.
    for (const id of channelsReady.keys()) if (id.startsWith('gb-tone-custom-') && !keep.includes(id)) channelsReady.delete(id);
  } catch (_) {
    /* an older APK, or no channels on this platform */
  }
}

export function localNotificationsAvailable() {
  return isNative() && !!nativePlugin('LocalNotifications');
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function localNotificationPermission() {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return 'unsupported';
  try {
    const r = await LN.checkPermissions();
    return r && r.display ? r.display : 'prompt';
  } catch (_) {
    return 'unsupported';
  }
}

/** Raise the system prompt. Returns the resulting permission string. */
export async function requestLocalNotifications() {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return 'unsupported';
  try {
    const r = await LN.requestPermissions();
    return r && r.display ? r.display : 'denied';
  } catch (_) {
    return 'denied';
  }
}

/**
 * Fire or schedule a batch. Each entry is `{ id, title, body, at, sound }`; omit `at`
 * to show it now. Ids must be a 32-bit int, and scheduling one that's already
 * pending replaces it rather than adding a second.
 *
 * `allowWhileIdle` is what makes a reminder arrive on time rather than whenever
 * Doze next lets the device wake — without it an overnight reminder can land
 * hours late, which for a reminder is the same as not arriving.
 */
export async function scheduleLocalNotifications(items) {
  const LN = nativePlugin('LocalNotifications');
  if (!LN || !items.length) return false;
  try {
    // Cheap after the first of each id — ensureChannel returns on a Set hit.
    for (const n of items) {
      if (!(await ensureChannel(LN, n.channelId, n.sound, n.customSound))) {
        n.channelId = versionedChannel('gb-tone-default');
        await ensureChannel(LN, n.channelId);
      }
    }
    await LN.schedule({
      notifications: items.map((n) => ({
        id: n.id | 0,
        title: n.title,
        body: n.body,
        // Always set, so the plugin never falls back to inventing one of its
        // own at an importance that cannot banner. See ensureChannel above.
        channelId: n.channelId,
        // Also passed to the notification, though on Android 8+ the channel's
        // sound is the one that plays. It is what ensureChannel built the
        // channel from, and it is still what rings on iOS and pre-8 Android.
        sound: n.sound,
        // The buttons (registerNotificationActions) and what they act on.
        actionTypeId: n.actionTypeId,
        extra: n.extra,
        schedule: n.at ? { at: n.at, allowWhileIdle: true } : undefined,
      })),
    });
    return true;
  } catch (_) {
    return false;
  }
}

/* ---- Notification buttons ------------------------------------------------
   "Done", "Snooze", "+250 ml" on the card itself. The button sets live on the
   phone under an id (registerActionTypes, idempotent: it overwrites), and each
   notification names its set with `actionTypeId`. A press reaches the page as
   a `localNotificationActionPerformed` event on iOS, which opens the app since
   each action is `foreground`. Android carries a press out without opening the
   app: the mobile repo patches the plugin to send it to NotificationActionReceiver
   (setNativeAuth below); an APK without that receiver still opens the app and
   delivers the event here. The plugin retains the event until a listener is
   attached, so a press that cold-starts the app is not lost. */

/** Register the button sets (`[{ id, actions: [{ id, title }] }]`). No-op off-device. */
export async function registerNotificationActions(types) {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return;
  try {
    await LN.registerActionTypes({ types });
  } catch (_) {
    /* an older plugin without buttons: the notifications still post */
  }
}

/**
 * Call `cb({ actionId, notification })` for every press on one of our
 * notifications (`actionId` 'tap' for the card itself). Once per page; there
 * is no remove because nothing ever needs to stop listening.
 */
export function onLocalNotificationAction(cb) {
  if (!isNative()) return;
  const cap = window.Capacitor;
  const eventName = 'localNotificationActionPerformed';
  const registered = cap.Plugins && cap.Plugins.LocalNotifications;
  try {
    if (registered && typeof registered.addListener === 'function') {
      registered.addListener(eventName, cb);
    } else if (typeof cap.nativeCallback === 'function') {
      // What a registered plugin's addListener does under the hood.
      cap.nativeCallback('LocalNotifications', 'addListener', { eventName }, cb);
    }
  } catch (_) {
    /* no plugin on this build */
  }
}

/* Android carries out a notification button itself, app closed
   (NotificationActionReceiver in the mobile repo): it needs this session's token
   and the API base, kept natively and wiped on sign-out. An APK without the
   plugin opens the app for a press, as before; these are then no-ops. */
export function setNativeAuth(token, base) {
  const p = nativePlugin('NotificationActions');
  if (!p || !token || !base) return;
  p.setAuth({ token, base }).catch(() => {});
}

export function clearNativeAuth() {
  const p = nativePlugin('NotificationActions');
  if (p) p.clearAuth().catch(() => {});
}

/** `cb()` when a press changes something while this page is running. */
export function onNativeChanges(cb) {
  if (!isNative()) return;
  const cap = window.Capacitor;
  const registered = cap.Plugins && cap.Plugins.NotificationActions;
  try {
    if (registered && typeof registered.addListener === 'function') registered.addListener('changed', cb);
    else if (typeof cap.nativeCallback === 'function')
      cap.nativeCallback('NotificationActions', 'addListener', { eventName: 'changed' }, cb);
  } catch (_) {
    /* an APK without the plugin */
  }
}

/** True once after a press changed something with the app away; then refetch. */
export async function takeNativeChanges() {
  const p = nativePlugin('NotificationActions');
  if (!p) return false;
  try {
    return !!(await p.takeChanged()).changed;
  } catch (_) {
    return false;
  }
}

/** One notification. Thin wrapper so the single-shot callers stay readable. */
export function scheduleLocalNotification(item) {
  return scheduleLocalNotifications([item]);
}

/* Cancel specific ids. Distinct from cancelPendingLocalNotifications below,
   which clears the whole queue — the focus timer must be able to drop its own
   alarm without taking every queued reminder with it. */
export async function cancelLocalNotifications(ids) {
  const LN = nativePlugin('LocalNotifications');
  if (!LN || !ids || !ids.length) return;
  try {
    await LN.cancel({ notifications: ids.map((id) => ({ id: id | 0 })) });
  } catch (_) {
    /* nothing queued under those ids */
  }
}

/* The focus timer's session-end alarm. Id 2 is its alone: 1 is the push test
   notification, and the reminder queue's ids are derived from the minute they
   fire in, far above both. Lives here so push.js can leave it queued. */
export const TIMER_ALARM_ID = 2;

/** The pending ids to cancel, minus the ones in `keep`. Pure, for push.test.mjs. */
export function idsToCancel(pending, keep = []) {
  return (pending || [])
    .map((n) => n && n.id)
    .filter((id) => id !== undefined && id !== null && keep.indexOf(id | 0) === -1);
}

/**
 * Drop everything queued but not yet shown, except the ids in `keep`. A
 * reminder re-sync passes `[TIMER_ALARM_ID]`: it rebuilds its own alarms, and
 * wiping the whole queue silently took a running focus session's end alarm
 * with it. Logout passes nothing — then every alarm goes. Delivered
 * notifications are not pending and are left alone, so this never clears a
 * reminder off the shade.
 */
export async function cancelPendingLocalNotifications({ keep = [] } = {}) {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return;
  try {
    const pending = await LN.getPending();
    const ids = idsToCancel((pending && pending.notifications) || [], keep);
    if (ids.length) {
      await LN.cancel({ notifications: ids.map((id) => ({ id })) });
    }
  } catch (_) {
    /* nothing queued, or the plugin is unhappy — the reschedule below still runs */
  }
}

/* ---- Splash screen and status bar ----------------------------------------
   Two things that give a WebView app away. The splash covers the 300-800ms the
   WebView spends parsing and painting, during which it shows its own white
   background — a strobe against the dark theme. The status bar is drawn by
   Android, not by us, so it keeps its default colours and seams against the
   header unless we match it to the theme on every switch. */

/** Resolve a CSS custom property to the hex the theme actually uses. */
function themeColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v.startsWith('#') ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Paint the status bar to match the current theme. Call on boot and on every
 * theme change — Android keeps whatever it was last told.
 */
export async function applyNativeStatusBar(theme) {
  const SB = nativePlugin('StatusBar');
  if (!SB) return;
  const dark = theme === 'dark';
  // Each call on its own: one that rejects must not skip the rest. iOS has no
  // setBackgroundColor, and on Android 15+ (edge-to-edge enforced) the first
  // two are no-ops or refusals — setStyle, the icon colour, still has to land.
  const calls = [
    // Solid bar rather than drawing under it: the header already reserves
    // max(env(safe-area-inset-top), 22px), so an overlay would double the gap.
    () => SB.setOverlaysWebView({ overlay: false }),
    () => SB.setBackgroundColor({ color: themeColor('--bg', dark ? '#16110E' : '#FFFCFA') }),
    // Capacitor names these after the background, not the icons: Dark means a
    // dark bar, which gets light icons.
    () => SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' }),
  ];
  for (const call of calls) {
    try {
      await call();
    } catch (_) {
      /* a themed status bar is never worth breaking boot over */
    }
  }
}

/* ---- Deep links ------------------------------------------------------------
   An https link to the web app (an invite, a shared #/money) opens the app
   once the manifest's intent-filter / iOS Associated Domains claim the host.
   The App plugin hands the URL over two ways: `getLaunchUrl` when the link
   cold-started the app, the `appUrlOpen` event when it was already running.
   Either way only the hash matters — the app is the same SPA on a different
   origin — so the route goes through the same hashchange as a typed URL. */

/** '#/circle?join=AB12' from a full link, or null when it names no route. Pure. */
export function deepLinkHash(url) {
  try {
    const hash = new URL(String(url)).hash;
    return /^#\/[a-z]/i.test(hash) ? hash : null;
  } catch (_) {
    return null;
  }
}

/** Call `cb(url)` for the link that opened the app and every one after. No-op off-device. */
export function onDeepLink(cb) {
  const App = isNative() ? nativePlugin('App') : null;
  if (!App) return;
  try {
    window.Capacitor.addListener('App', 'appUrlOpen', (ev) => ev && ev.url && cb(ev.url));
  } catch (_) {
    /* an older bridge without addListener: cold-start links still work below */
  }
  App.getLaunchUrl()
    .then((r) => r && r.url && cb(r.url))
    .catch(() => {});
}

/** Drop the splash once the first real frame is on screen. */
export function hideNativeSplash() {
  const SS = nativePlugin('SplashScreen');
  if (!SS) return;
  // Two frames: one for the render that just ran, one for the paint after it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      SS.hide().catch(() => {});
    })
  );
}

/* ---- Health ---------------------------------------------------------------
   Read from the OS health store (HealthKit / Health Connect), never from a
   sensor of ours. The phone already counts steps and the watch already records
   sleep; asking is one query, so there is no service, no listener and no battery
   cost. Plugin: @capgo/capacitor-health in the mobile repo, read-only — its
   manifest keeps READ_* for exactly HEALTH_READ and strips the rest.
   Only requestHealthAccess() opens a permission sheet. Every read below just
   reads: without access Health Connect throws and HealthKit answers empty, and
   both come back as null, so a boot-time read can never pop a dialog. */

/** What the Health screen shows. Each needs its READ_* in the mobile manifest. */
export const HEALTH_READ = [
  'steps',
  'distance',
  'calories',
  'flightsClimbed',
  'sleep',
  'heartRate',
  'restingHeartRate',
  'heartRateVariability',
  'oxygenSaturation',
  'respiratoryRate',
  'weight',
  'height',
  'bodyFat',
  'bloodPressure',
  'workouts',
];

function healthPlugin() {
  return isNative() ? nativePlugin('Health') : null;
}

/** True when this phone has a health store we can reach. */
export async function healthAvailable() {
  const Health = healthPlugin();
  if (!Health) return false;
  try {
    return !!(await Health.isAvailable()).available;
  } catch (_) {
    return false; // an older APK without the plugin
  }
}

/** Opens the OS sheet for every HEALTH_READ type. True unless it failed. */
export async function requestHealthAccess() {
  if (!(await healthAvailable())) return false;
  try {
    await healthPlugin().requestAuthorization({ read: HEALTH_READ });
    return true;
  } catch (_) {
    return false;
  }
}

function midnightToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* Sum of one type since local midnight, or null. Summed: a day bucket the
   store cuts on UTC can come back as two. HealthKit never says a read was
   denied, it just answers 0, so 0 is "don't know". */
async function sumToday(Health, dataType) {
  try {
    const { samples } = await Health.queryAggregated({
      dataType,
      startDate: midnightToday().toISOString(),
      endDate: new Date().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    const total = (samples || []).reduce((n, s) => n + (Number(s.value) || 0), 0);
    return total > 0 ? total : null;
  } catch (_) {
    return null;
  }
}

/** Today's steps so far, or null: off-device, no health store, or no access. */
export async function readTodaySteps() {
  if (!(await healthAvailable())) return null;
  // Asked here too: a Steps habit predates the setup step on older installs.
  // Already granted, it returns at once.
  await healthPlugin()
    .requestAuthorization({ read: ['steps'] })
    .catch(() => {});
  const n = await sumToday(healthPlugin(), 'steps');
  return n == null ? null : Math.round(n);
}

async function readSamples(Health, dataType, startDate, limit) {
  try {
    const { samples } = await Health.readSamples({
      dataType,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      limit,
      ascending: false,
    });
    return samples || [];
  } catch (_) {
    return [];
  }
}

const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const localKey = (d) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/* The night that ended on `dayKey` (local YYYY-MM-DD), from raw sleep samples,
   or null. HealthKit sends one sample per stage, Health Connect one per
   session; both are merged into stretches where a gap under 90 min (a trip to
   the kitchen, a watch taken off to charge) doesn't split the night. The
   longest stretch of 3 h+ ending that day wins, so an afternoon nap never
   becomes "last night". Awake samples are left out: they'd only stretch it. */
export function nightFromSamples(samples, dayKey) {
  const parts = (samples || [])
    .filter((s) => s && s.sleepState !== 'awake')
    .map((s) => ({ a: new Date(s.startDate), b: new Date(s.endDate) }))
    .filter((p) => p.b > p.a)
    .sort((x, y) => x.a - y.a);
  const runs = [];
  for (const p of parts) {
    const last = runs[runs.length - 1];
    if (last && p.a - last.b <= 90 * 60000) {
      if (p.b > last.b) last.b = p.b;
    } else runs.push({ a: p.a, b: p.b });
  }
  const best = runs
    .filter((r) => localKey(r.b) === dayKey && r.b - r.a >= 3 * 3600000)
    .sort((x, y) => y.b - y.a - (x.b - x.a))[0];
  if (!best) return null;
  return {
    bedtime: hhmm(best.a),
    wakeTime: hhmm(best.b),
    minutes: Math.round((best.b - best.a) / 60000),
  };
}

/* Today's reading for a habit's health link (nudges.js HEALTH_LINKS), in that
   link's unit, or null. Sleep is not here: it is read from today's sleep
   entry, which autoLogSleep fills from the phone and the user can edit. */
const LINK_TYPE = { steps: 'steps', distance: 'distance', calories: 'calories', floors: 'flightsClimbed' };
export async function readHealthValue(link) {
  if (!(await healthAvailable())) return null;
  const Health = healthPlugin();
  if (link === 'workout') {
    const workouts = await Health.queryWorkouts({
      startDate: midnightToday().toISOString(),
      endDate: new Date().toISOString(),
      limit: 50,
    })
      .then((r) => (r && r.workouts) || [])
      .catch(() => []);
    const min = workouts.reduce((n, w) => n + (Number(w.duration) || 0), 0) / 60; // seconds
    return min > 0 ? Math.round(min) : null;
  }
  if (!LINK_TYPE[link]) return null;
  const v = await sumToday(Health, LINK_TYPE[link]);
  if (v == null) return null;
  return link === 'distance' ? Math.round(v / 100) / 10 : Math.round(v);
}

/** Last night (the one that ended today), or null. Never asks for access. */
export async function readLastNight() {
  if (!(await healthAvailable())) return null;
  const from = midnightToday();
  from.setHours(-12); // noon yesterday: covers any bedtime
  const samples = await readSamples(healthPlugin(), 'sleep', from, 500);
  return nightFromSamples(samples, localKey(new Date()));
}

/* ---- Sync to the account ---------------------------------------------------
   The phone's numbers go to /api/health/sync so the Health screen can show
   history, and the web can show the phone's days. One row per type per day:
   daily totals for the sum metrics, the newest reading of each day for the
   rest. Re-sending a day overwrites it on the server, so a day still in
   progress is simply sent again later. */

const SYNC_SUMS = { steps: 'steps', distance: 'distance', calories: 'calories', floors: 'flightsClimbed' };
const SYNC_LATEST = {
  restingHeartRate: 'restingHeartRate',
  heartRateVariability: 'heartRateVariability',
  oxygenSaturation: 'oxygenSaturation',
  respiratoryRate: 'respiratoryRate',
  weight: 'weight',
  height: 'height',
  bodyFat: 'bodyFat',
  bloodPressure: 'bloodPressure',
};
// HealthKit's percent unit is 0-1, Health Connect's 0-100. No real SpO2 or
// body-fat reading is at or under 1%, so <= 1 means a fraction.
const PERCENT = new Set(['oxygenSaturation', 'bodyFat']);

/* Sum of one type over [from, to), or null. Every bucket is added: the store
   may cut its day buckets on UTC, so one local day can come back as two. */
async function sumBetween(Health, dataType, from, to) {
  try {
    const { samples } = await Health.queryAggregated({
      dataType,
      startDate: from.toISOString(),
      endDate: to.toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    const total = (samples || []).reduce((n, s) => n + (Number(s.value) || 0), 0);
    return total > 0 ? total : null;
  } catch (_) {
    return null;
  }
}

/** Readings for /api/health/sync covering the last `days` local days (today included), or null off-device. */
export async function readHealthForSync(days = 7) {
  if (!(await healthAvailable())) return null;
  const Health = healthPlugin();
  const out = [];
  const start = midnightToday();
  start.setDate(start.getDate() - (days - 1));
  const dayStarts = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  await Promise.all(
    Object.entries(SYNC_SUMS).flatMap(([type, dataType]) =>
      dayStarts.map(async (from) => {
        const to = new Date(from);
        to.setDate(from.getDate() + 1);
        const v = await sumBetween(Health, dataType, from, to > new Date() ? new Date() : to);
        if (v == null) return;
        out.push({ type, day: localKey(from), value: type === 'distance' ? Math.round(v / 100) / 10 : Math.round(v) });
      })
    )
  );

  // Workouts: total minutes per day; the note names what they were.
  const workouts = await Health.queryWorkouts({ startDate: start.toISOString(), endDate: new Date().toISOString(), limit: 200 })
    .then((r) => (r && r.workouts) || [])
    .catch(() => []);
  const byDay = {};
  workouts.forEach((w) => {
    const day = localKey(new Date(w.startDate));
    const e = (byDay[day] = byDay[day] || { min: 0, kinds: new Set() });
    e.min += (Number(w.duration) || 0) / 60; // seconds
    if (w.workoutType) e.kinds.add(String(w.workoutType).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  });
  Object.entries(byDay).forEach(([day, e]) => {
    if (e.min >= 1) out.push({ type: 'workout', day, value: Math.round(e.min), note: [...e.kinds].join(', ').slice(0, 280) || null });
  });

  // The newest reading of each day for everything measured rather than counted.
  await Promise.all(
    Object.entries(SYNC_LATEST).map(async ([type, dataType]) => {
      const samples = await readSamples(Health, dataType, start, 200);
      const seen = new Set();
      samples
        .slice()
        .sort((a, b) => Date.parse(b.endDate || b.startDate) - Date.parse(a.endDate || a.startDate))
        .forEach((s) => {
          const at = new Date(s.endDate || s.startDate);
          const day = localKey(at);
          if (seen.has(day)) return;
          let value = type === 'bloodPressure' ? Number(s.systolic) : Number(s.value);
          if (!Number.isFinite(value) || value <= 0) return;
          if (PERCENT.has(type) && value <= 1) value *= 100;
          seen.add(day);
          const r = { type, day, value: Math.round(value * 10) / 10, measuredAt: at.toISOString() };
          if (type === 'bloodPressure') r.value2 = Number(s.diastolic);
          out.push(r);
        });
    })
  );
  return out;
}

/* ---------------------------------------------------------------------
   Money's automatic capture: the GbCapture plugin (../Growth-Buddy-Mobile,
   com.growthbuddy.capture). Android only; null on the web, on iOS and in an
   APK built without it, so every caller just checks for null.
     status()                 -> {notifAccess, smsGranted, smsAvailable}
     setSources({notif, sms}) -> the native side stops queueing what is off
     openNotificationAccess() -> the system "Notification access" page
     requestSms()             -> {granted}  (only in a build that declares SMS)
     peek()                   -> {items: [{id, via, origin, text, at}]}, kept until ack
     ack({ids})               -> forget those (the server took them, or no payment)
     readSmsInbox({sinceMs})  -> {items} bank-looking SMS since then, nothing kept
     takeShared()             -> {text} the text another app shared in, once
   The queue holds payment-looking text only until this app next opens; the
   text is parsed here (bank-msg.js) and never sent anywhere.
   --------------------------------------------------------------------- */
export function capturePlugin() {
  if (!isNative()) return null;
  return nativePlugin('GbCapture');
}

/** Another app shared text in while this one was open: the plugin's 'shared' event. */
export function onSharedText(cb) {
  if (!capturePlugin()) return;
  const cap = window.Capacitor;
  const registered = cap.Plugins && cap.Plugins.GbCapture;
  try {
    if (registered && typeof registered.addListener === 'function') registered.addListener('shared', cb);
    else if (typeof cap.nativeCallback === 'function')
      cap.nativeCallback('GbCapture', 'addListener', { eventName: 'shared' }, cb);
  } catch (_) {
    /* an APK without the plugin */
  }
}
