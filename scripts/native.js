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
 * ponytail: promise-style methods only. A plugin listener would need
 * `cap.nativeCallback`; nothing here uses one.
 */
export function nativePlugin(name) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!cap) return null;
  const registered = cap.Plugins && cap.Plugins[name];
  if (registered) return registered;
  if (typeof cap.nativePromise !== 'function') return null;
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
  // Backstop. The splash is held open by hand (launchAutoHide:false), so a throw
  // anywhere before the render would strand the user on it with no way out.
  // hide() is idempotent, so the normal path racing this is harmless.
  const SS = nativePlugin('SplashScreen');
  if (SS) setTimeout(() => SS.hide().catch(() => {}), 4000);
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

   ponytail: the ids are plain. Because Android freezes them, changing a
   channel's importance or sound later needs a NEW id — that day the fix is a
   suffix (`gb-tone-chime-2`), not an edit to the values here. */
export const SILENT_CHANNEL = 'gb-silent';

/* createChannel is idempotent but not free, and this runs per batch. A failed
   call is marked done too: failure means the platform has no channels, and
   retrying that once per schedule would cost a round trip forever. */
const channelsReady = new Set();

/** 'gb-tone-chime' -> 'Chime', for the row the user sees in Settings. */
function toneName(id) {
  const key = id.replace(/^gb-tone-/, '');
  return key.charAt(0).toUpperCase() + key.slice(1);
}

async function ensureChannel(LN, id, sound) {
  if (!id || channelsReady.has(id)) return;
  channelsReady.add(id);
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
    for (const n of items) await ensureChannel(LN, n.channelId, n.sound);
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
        schedule: n.at ? { at: n.at, allowWhileIdle: true } : undefined,
      })),
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** One notification. Thin wrapper so the single-shot callers stay readable. */
export function scheduleLocalNotification(item) {
  return scheduleLocalNotifications([item]);
}

/**
 * Drop everything queued but not yet shown. Delivered notifications are not
 * pending and are left alone, so this never clears a reminder off the shade.
 */
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

export async function cancelPendingLocalNotifications() {
  const LN = nativePlugin('LocalNotifications');
  if (!LN) return;
  try {
    const pending = await LN.getPending();
    const list = (pending && pending.notifications) || [];
    if (list.length) {
      await LN.cancel({ notifications: list.map((n) => ({ id: n.id })) });
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
  try {
    // Solid bar rather than drawing under it: the header already reserves
    // max(env(safe-area-inset-top), 22px), so an overlay would double the gap.
    await SB.setOverlaysWebView({ overlay: false });
    await SB.setBackgroundColor({ color: themeColor('--bg', dark ? '#16110E' : '#FFFCFA') });
    // Capacitor names these after the background, not the icons: Dark means a
    // dark bar, which gets light icons.
    await SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
  } catch (_) {
    /* a themed status bar is never worth breaking boot over */
  }
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

/* ---- Steps ---------------------------------------------------------------
   Read from the OS health store (HealthKit / Health Connect), never from a
   sensor of ours. The phone already counts steps all day on its low-power
   motion chip; asking for today's total is one query, so there is no service,
   no listener and no battery cost. Plugin: @capgo/capacitor-health in the
   mobile repo, whose manifest strips every health permission but READ_STEPS.
   ponytail: read on demand, today only. Back-filling earlier days, or ticking
   a steps habit by itself, needs a target the habit doesn't have yet. */

/** Today's steps so far, or null: off-device, no health store, or no access. */
export async function readTodaySteps() {
  const Health = isNative() ? nativePlugin('Health') : null;
  if (!Health) return null;
  try {
    const { available } = await Health.isAvailable();
    if (!available) return null;
    // Opens the permission sheet once; already granted, it returns at once.
    await Health.requestAuthorization({ read: ['steps'] });
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const { samples } = await Health.queryAggregated({
      dataType: 'steps',
      startDate: midnight.toISOString(),
      endDate: new Date().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    // Summed: a day bucket the store cuts on UTC can come back as two.
    const total = (samples || []).reduce((n, s) => n + (Number(s.value) || 0), 0);
    // HealthKit never says a read was denied, it just answers 0, so a 0 is
    // treated as "don't know" rather than pre-filled.
    return total > 0 ? Math.round(total) : null;
  } catch (_) {
    // An older APK without the plugin, or the sheet dismissed: type it in.
    return null;
  }
}
