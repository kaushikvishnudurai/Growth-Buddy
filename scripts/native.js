/* =====================================================================
   Growth Buddy — native shell helpers
   Everything that only means something inside the Capacitor app. Plugins are
   reached through `window.Capacitor.Plugins` rather than imported: the plugin
   packages live in ../Growth-Buddy-Mobile, so an import would break the web
   build. Same trick as the speech-recognition call in app.js.
   ===================================================================== */

export function isNative() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : cap.isNative));
}

function plugin(name) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return (cap && cap.Plugins && cap.Plugins[name]) || null;
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
  const SS = plugin('SplashScreen');
  if (SS) setTimeout(() => SS.hide().catch(() => {}), 4000);
  const Device = plugin('Device');
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

export function localNotificationsAvailable() {
  return isNative() && !!plugin('LocalNotifications');
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function localNotificationPermission() {
  const LN = plugin('LocalNotifications');
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
  const LN = plugin('LocalNotifications');
  if (!LN) return 'unsupported';
  try {
    const r = await LN.requestPermissions();
    return r && r.display ? r.display : 'denied';
  } catch (_) {
    return 'denied';
  }
}

/**
 * Fire or schedule one notification. `at` is a Date; omit it to show the
 * notification now. Ids must be a 32-bit int — callers pass a stable one so a
 * reschedule replaces rather than duplicates.
 */
export async function scheduleLocalNotification({ id, title, body, at }) {
  const LN = plugin('LocalNotifications');
  if (!LN) return false;
  try {
    await LN.schedule({
      notifications: [
        {
          id: id | 0,
          title,
          body,
          schedule: at ? { at } : undefined,
        },
      ],
    });
    return true;
  } catch (_) {
    return false;
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
  const SB = plugin('StatusBar');
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
  const SS = plugin('SplashScreen');
  if (!SS) return;
  // Two frames: one for the render that just ran, one for the paint after it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      SS.hide().catch(() => {});
    })
  );
}
