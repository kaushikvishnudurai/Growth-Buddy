/* =====================================================================
   Growth Buddy — hand a file to the OS
   Every export (Download my data, the reminders .ics, the Money CSV, a story
   card) goes through offerFile, so each says only what actually happened.

   The ladder: the native share sheet via Filesystem + Share (only once those
   plugins are in the mobile app), the Web Share API with a File, a plain
   <a download>. That last step is the one that does nothing in the Capacitor
   WebView, which sets no DownloadListener, and every export used to toast
   "downloading" over it. In the app it now says plainly that saving files is
   not there yet, and offers the website, where the same button works.
   ===================================================================== */

import { isNative, nativePlugin, publicSiteUrl } from './native.js';
import { toast } from './toast.js';

/**
 * @param {{shareFirst?: boolean}} [opts]
 * @returns {Promise<'shared'|'saved'|'unavailable'>} `shared` when a share
 *   sheet took it (or was dismissed: the platform doesn't say which), `saved`
 *   when a browser download started, `unavailable` in the app when neither
 *   works; that case has already told the user, so callers only toast `saved`.
 */
export async function offerFile(blob, filename, title, { shareFirst = true } = {}) {
  if (isNative()) {
    const native = await shareNatively(blob, filename, title);
    if (native) return native;
  }
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
  // canShare({files}) is the only honest test: Android WebView and desktop
  // Firefox have navigator.share but reject files. shareFirst: false (the
  // Money CSV, a file for a spreadsheet) goes straight to the download on the
  // web; in the app the sheet is the only way out, so it is always tried.
  if (
    (shareFirst || isNative()) &&
    file &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'shared';
      // Anything else falls through to the next rung.
    }
  }
  if (isNative()) {
    toast.action(
      "Saving files isn't available in the app yet. Sign in on the website to download it.",
      'Open website',
      () => openExternal(publicSiteUrl() + '/')
    );
    return 'unavailable';
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

/** The system browser in the app (Capacitor Browser), a new tab on the web. */
function openExternal(url) {
  const browser = isNative() ? nativePlugin('Browser') : null;
  if (browser) browser.open({ url }).catch(() => window.open(url, '_blank', 'noopener'));
  else window.open(url, '_blank', 'noopener');
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

/**
 * The Capacitor path: Filesystem.writeFile into the cache directory, then
 * Share.share with that file's URI. Resolves 'shared', or null when either
 * plugin is missing from this APK (or fails) so the caller moves on.
 * `nativePlugin` hands back a proxy whether or not the native class exists, so
 * "missing" only shows up as a rejected call, hence the try.
 */
async function shareNatively(blob, filename, title) {
  const FS = nativePlugin('Filesystem');
  const Share = nativePlugin('Share');
  if (!FS || !Share) return null;
  let uri;
  try {
    const data = await blobToBase64(blob);
    // 'CACHE' is Directory.Cache's value; the enum lives in the plugin package.
    const res = await FS.writeFile({ path: filename, data, directory: 'CACHE' });
    uri = res && res.uri;
  } catch (_) {
    return null;
  }
  if (!uri) return null;
  try {
    await Share.share({ title, files: [uri] });
    return 'shared';
  } catch (err) {
    // A dismissed sheet rejects with "Share canceled": still a share offered,
    // same as the web AbortError. Anything else (UNIMPLEMENTED) moves on.
    const msg = String((err && err.message) || err || '');
    return /cancel/i.test(msg) ? 'shared' : null;
  }
}
