/* =====================================================================
   Growth Buddy — the camera question, asked again on every camera tap
   Picking a camera option after "Don't allow" used to do nothing: Android
   stops showing its dialog after the second refusal and the WebView's own
   prompt gives up without a word, and a browser never re-asks a site the
   user blocked. The phone app asks again whenever Android still lets it
   (installCameraGate, cameraAskAgain), otherwise offers the app's settings
   page; a browser gets the address-bar steps and a Try again.
   ===================================================================== */
import { isNative, nativePlugin } from './native.js';
import { confirmDialog } from './gb-kit.js';
import { toast } from './toast.js';

// The phone answered "granted" this session: open straight from the tap.
let nativeGranted = false;

// A file picker only opens inside the tap's user activation (about 5 s in
// Chromium); a permission dialog answered slower than this leaves the
// picker dead, so the user is asked to tap once more instead.
const GESTURE_MS = 4000;

/** The phone's camera state for this tap: 'granted', 'denied' (they just said no),
 * 'blocked' (only a settings change helps), or 'unknown' (an older app build:
 * the WebView asks as before). Asks Android again whenever it still shows the dialog. */
async function cameraState() {
  if (nativeGranted) return 'granted';
  const perms = nativePlugin('AppPermissions');
  if (!perms) return 'unknown';
  try {
    const { state } = await perms.requestCamera();
    nativeGranted = state === 'granted';
    return state === 'granted' ? 'granted' : state === 'blocked' ? 'blocked' : 'denied';
  } catch (_) {
    return 'unknown';
  }
}

/** Tell the user where the camera switch is; true when they asked to try again. */
async function explainBlockedCamera() {
  if (isNative()) {
    const go = await confirmDialog({
      title: 'Camera is off for Growth Buddy',
      message: 'Android will not ask again from here. Open the app settings, tap Permissions, then Camera, and choose Allow.',
      confirmLabel: 'Open settings',
      cancelLabel: 'Not now',
    });
    const perms = go && nativePlugin('AppPermissions');
    if (perms) perms.openSettings().catch(() => {});
    return false;
  }
  return confirmDialog({
    title: 'Camera is blocked for this site',
    message:
      'Your browser will not ask again until you allow it. Tap the icon at the left of the address bar, open Site settings, set Camera to Allow, then try again.',
    confirmLabel: 'Try again',
    cancelLabel: 'Not now',
  });
}

/* Run `open` (a file picker) once the phone may use the camera, asking again first. */
async function withCamera(open) {
  const started = Date.now();
  const state = await cameraState();
  if (state === 'blocked') {
    await explainBlockedCamera();
    return;
  }
  if (state === 'denied') return; // they just said no to the dialog
  if (Date.now() - started > GESTURE_MS) {
    // ponytail: the tap's activation ran out while the dialog was up; one more tap opens it.
    toast.success('Camera allowed. Tap once more to take the photo.');
    return;
  }
  open();
}

/**
 * After the camera was refused (a NotAllowedError from getUserMedia): ask again
 * where the platform still can, else explain. True when the caller should retry.
 */
export async function cameraAskAgain() {
  if (isNative()) {
    const state = await cameraState();
    if (state === 'granted') return true;
    if (state === 'blocked') await explainBlockedCamera();
    return false;
  }
  return explainBlockedCamera();
}

/**
 * Every photo button opens an <input type=file capture> (snap, receipts, food,
 * pantry, groceries). In the phone app the WebView asks for the camera itself
 * but goes quiet once Android stops showing its dialog, so the tap did nothing.
 * One capture-phase listener holds that click, asks first (withCamera), then
 * clicks again. A browser needs no gate: the camera app takes the photo, not
 * the site. Inputs never attached to the page skip it (none do today).
 */
export function installCameraGate() {
  if (!isNative() || typeof document === 'undefined') return;
  const passed = new WeakSet();
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !el.hasAttribute('capture')) return;
      if (passed.has(el)) {
        passed.delete(el);
        return;
      }
      if (nativeGranted) return;
      e.preventDefault();
      withCamera(() => {
        passed.add(el);
        el.click();
      });
    },
    true
  );
}
