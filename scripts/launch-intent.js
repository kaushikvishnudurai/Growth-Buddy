/* =====================================================================
   Growth Buddy — what the address this load opened with asks for
   The manifest's shortcuts open /?shortcut=<id>; its share_target (a POST the
   service worker answers, public/share-target.js) sends words on as
   /?title=&text=&url= and a picture as /?share=image. app.js reads this once at boot, strips the query
   from the address so a reload doesn't repeat it, and acts on it after the
   first data load (runLaunchIntent). Pure, for launch-intent.test.mjs.
   ===================================================================== */

/** The manifest's shortcut ids (vite.config.js manifest.shortcuts). */
export const SHORTCUTS = ['water', 'task', 'focus', 'quickadd'];

/** Longest shared text handed to Quick add; a pasted article is not a log line. */
export const SHARE_MAX = 500;

/**
 * @param {string} search location.search
 * @returns {{shortcut: string} | {share: string} | {shareImage: true} | null}
 */
export function launchIntent(search) {
  const p = new URLSearchParams(search || '');
  const shortcut = p.get('shortcut');
  if (shortcut && SHORTCUTS.includes(shortcut)) return { shortcut };
  if (p.get('share') === 'image') return { shareImage: true };
  // A share sheet fills whichever it likes: Android often puts the link in
  // `text`, some apps repeat the title inside the text. Keep each part once.
  const parts = ['title', 'text', 'url']
    .map((k) => (p.get(k) || '').trim())
    .filter(Boolean);
  const kept = parts.filter(
    (part, i) => !parts.some((other, j) => j !== i && other.includes(part) && (other !== part || j < i))
  );
  if (!kept.length) return null;
  return { share: kept.join(' ').slice(0, SHARE_MAX) };
}

