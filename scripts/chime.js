/* =====================================================================
   Growth Buddy — notification chimes
   Synthesised, not sampled. A table of oscillator notes is ~2 kB of code
   where a set of .mp3s is a few hundred kB in the bundle *and* in the APK,
   needs a licence check each, and still wouldn't be ours. These are.
   Every sound is the same shape — a few notes, each a sine or triangle with
   a fast attack and an exponential tail — so adding one is a row in SOUNDS,
   not a new code path.
   These also ARE the phone's notification sound in the app: `gen-chimes.mjs`
   renders the same table out to `public/gb-<key>.wav`, which rides in the
   bundle, and @capacitor/local-notifications resolves a notification's `sound`
   from the app's web assets and makes the per-sound Android channel itself.
   So: edit SOUNDS, re-run `node scripts/gen-chimes.mjs`.
   ponytail: the user's OWN uploaded file stays in-app. It lives as a data URL
   in CacheStorage, and Android can only ring a file that shipped with the app;
   giving it a channel means writing it out natively, which is a plugin.
   ===================================================================== */

/* { f: Hz, t: seconds from the start, d: seconds to decay, g: peak gain,
     type: oscillator type (default sine), to: Hz to glide to over d } */
export const SOUNDS = {
  bloom: [
    { f: 587.33, t: 0, d: 0.55, g: 0.1 }, // D5
    { f: 880, t: 0.085, d: 0.7, g: 0.085 }, // A5 — a fifth above, opening up
    { f: 1760, t: 0.085, d: 0.3, g: 0.018, type: 'triangle' },
  ],
  droplet: [
    { f: 1046.5, t: 0, d: 0.26, g: 0.09, to: 660 }, // pitch falls: a drop landing
    { f: 523.25, t: 0.02, d: 0.5, g: 0.05 },
  ],
  chime: [
    { f: 523.25, t: 0, d: 0.6, g: 0.075, type: 'triangle' }, // C5
    { f: 659.25, t: 0.1, d: 0.6, g: 0.07, type: 'triangle' }, // E5
    { f: 783.99, t: 0.2, d: 0.75, g: 0.065, type: 'triangle' }, // G5
  ],
  marimba: [
    { f: 440, t: 0, d: 0.32, g: 0.11 },
    { f: 1320, t: 0, d: 0.09, g: 0.05, type: 'triangle' }, // wooden knock: 3rd harmonic, gone fast
    { f: 660, t: 0.13, d: 0.4, g: 0.07 },
  ],
  hush: [
    { f: 329.63, t: 0, d: 0.9, g: 0.06 }, // E4, one note, barely there
    { f: 493.88, t: 0.06, d: 0.8, g: 0.03 },
  ],
};

/* The picker's order and wording. `off` is a real choice, not the absence of
   one, so it lives here too. */
export const CHIMES = [
  { key: 'bloom', label: 'Bloom', hint: 'Warm, two notes rising' },
  { key: 'droplet', label: 'Droplet', hint: 'A single soft drop' },
  { key: 'chime', label: 'Chime', hint: 'Three notes, like a glass bell' },
  { key: 'marimba', label: 'Marimba', hint: 'Wooden and short' },
  { key: 'hush', label: 'Hush', hint: 'Quietest of the five' },
  { key: 'off', label: 'Silent', hint: 'No sound in the app' },
];

export const DEFAULT_CHIME = 'bloom';

let ctx = null;

/* One context for the life of the tab. Browsers start it suspended until a
   gesture; a notification isn't one, so resume() runs on every play and the
   first sound of a session can be swallowed if the user hasn't touched
   anything yet. That's the autoplay policy, not a bug we can fix here. */
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/* ---------------------------------------------------------------------
   A sound the user brought themselves.
   The file lives in CacheStorage on THIS device; ui_prefs syncs the *choice*,
   not the bytes — a few hundred kB of base64 in the user row would ride along
   with every /api/auth/me. On another device 'custom' finds nothing stored and
   quietly falls back to the default chime.
   ------------------------------------------------------------------ */

export const CUSTOM_MAX_BYTES = 300 * 1024;
/* Whatever they picked, a notification is not a song. */
const CUSTOM_MAX_MS = 5000;

let customUrl = null;
let customEl = null;
let customTimer = null;

/** Hand the stored data URL (or null to forget it) to the player. */
export function setCustomChime(url) {
  customUrl = url || null;
  if (customEl) {
    try {
      customEl.pause();
    } catch (_) {
      /* ignore */
    }
    customEl = null;
  }
}

export function hasCustomChime() {
  return !!customUrl;
}

/**
 * Read a picked file into a data URL, rejecting what we won't store.
 * Throws an Error whose message is already user-facing.
 */
export function readCustomChime(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file chosen.'));
    if (!/^audio\//.test(file.type || ''))
      return reject(new Error('That isn’t an audio file — pick an mp3, m4a, ogg or wav.'));
    if (file.size > CUSTOM_MAX_BYTES)
      return reject(
        new Error(
          'Keep it under ' +
            Math.round(CUSTOM_MAX_BYTES / 1024) +
            ' KB — a notification is a second or two, not a track.'
        )
      );
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

function playCustom() {
  if (!customUrl) return playChime(DEFAULT_CHIME);
  try {
    if (!customEl) customEl = new Audio(customUrl);
    customEl.currentTime = 0;
    customEl.volume = 0.7;
    customEl.play().catch(() => {});
    clearTimeout(customTimer);
    customTimer = setTimeout(() => {
      try {
        customEl.pause();
      } catch (_) {
        /* ignore */
      }
    }, CUSTOM_MAX_MS);
    return true;
  } catch (_) {
    return false;
  }
}

/** Play one of SOUNDS, or the user's own file. 'off'/unknown → silence. */
export function playChime(key) {
  if (key === 'custom') return playCustom();
  const notes = SOUNDS[key];
  if (!notes) return false;
  const c = audio();
  if (!c) return false;
  const t0 = c.currentTime + 0.01;
  notes.forEach((n) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type || 'sine';
    osc.frequency.setValueAtTime(n.f, t0 + n.t);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.t + n.d);
    // exponentialRamp can't touch zero, hence the near-silent floor.
    gain.gain.setValueAtTime(0.0001, t0 + n.t);
    gain.gain.linearRampToValueAtTime(n.g, t0 + n.t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.02);
  });
  return true;
}

/* ---------------------------------------------------------------------
   Self-check — Vite DEV only. Renders each sound offline and asserts it
   actually makes noise, which is the one thing a typo in SOUNDS breaks
   silently. OfflineAudioContext runs headless: nothing is heard.
   ------------------------------------------------------------------ */
export async function _demo() {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return;
  const real = ctx;
  for (const key of Object.keys(SOUNDS)) {
    const off = new OAC(1, 44100 * 2, 44100);
    ctx = off; // playChime() writes into the offline graph instead
    playChime(key);
    const buf = await off.startRendering();
    const data = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    console.assert(peak > 0.01, 'chime ' + key + ' is silent (peak ' + peak.toFixed(4) + ')');
    console.assert(peak < 0.5, 'chime ' + key + ' is too loud (peak ' + peak.toFixed(4) + ')');
  }
  ctx = real;
  console.assert(playChime('off') === false, "'off' should play nothing");
  console.assert(playChime('nope') === false, 'unknown key should play nothing');

  // The custom-file gate. Nothing plays here — these all reject before decoding.
  const rejects = async (file, why) => {
    try {
      await readCustomChime(file);
      console.assert(false, 'readCustomChime should reject ' + why);
    } catch (_) {
      /* expected */
    }
  };
  await rejects(new File(['x'], 'note.txt', { type: 'text/plain' }), 'a non-audio file');
  await rejects(
    new File([new Uint8Array(CUSTOM_MAX_BYTES + 1)], 'big.mp3', { type: 'audio/mpeg' }),
    'a file over the size cap'
  );
  const url = await readCustomChime(new File(['id3'], 'ok.mp3', { type: 'audio/mpeg' }));
  console.assert(url.startsWith('data:audio/mpeg'), 'a small audio file should read as a data URL');
}

if (import.meta.env && import.meta.env.DEV) _demo();
