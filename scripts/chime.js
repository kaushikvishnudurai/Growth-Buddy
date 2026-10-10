/* =====================================================================
   Growth Buddy — notification chimes
   Synthesised, not sampled. A table of oscillator notes is ~2 kB of code
   where a set of .mp3s is a few hundred kB in the bundle *and* in the APK,
   needs a licence check each, and still wouldn't be ours. These are.
   Every sound is the same shape — a few notes, each an oscillator with a
   fast attack and an exponential tail — so adding one is a row in SOUNDS,
   not a new code path.
   These also ARE the phone's notification sound in the app: `gen-chimes.mjs`
   renders the same table out to `gb_<key>.wav` in both `public/` (the web
   bundle) and the Capacitor project's `res/raw/` — a notification channel's
   sound can only be a raw resource, and native.js builds those channels itself
   so they land at an importance that actually shows a banner.
   So: edit SOUNDS, re-run `node scripts/gen-chimes.mjs`.
   ponytail: the user's OWN uploaded file stays in-app. It lives as a data URL
   in CacheStorage, and Android can only ring a file that shipped with the app;
   giving it a channel means writing it out natively. That plugin now exists —
   CustomNotificationSoundPlugin in the Capacitor project — so do not write a
   second one. It is not reached yet: nothing registers it (MainActivity is an
   empty BridgeActivity, and capacitor.plugins.json only lists npm plugins), so
   an upload still falls back to the phone's own sound.
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
  alarm: [
    { f: 880, t: 0, d: 0.12, g: 0.42, type: 'square' }, // sharp double-beep
    { f: 880, t: 0.16, d: 0.12, g: 0.42, type: 'square' },
  ],
  buzz: [
    { f: 220, t: 0, d: 0.35, g: 0.45, type: 'sawtooth' }, // low, harsh, sustained
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
  { key: 'alarm', label: 'Alarm', hint: 'Sharp double beep, hard to miss' },
  { key: 'buzz', label: 'Buzz', hint: 'A hard, rattling buzz' },
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
   Sounds the user brought themselves — an uploaded file or a voice recording,
   up to CUSTOM_MAX_COUNT. The files live in CacheStorage on THIS device (and on
   the account, so another device can fetch them); ui_prefs syncs only the
   *choice*, never the bytes — a few hundred kB of base64 in the user row would
   ride along with every /api/auth/me.

   A custom sound's key is 'custom:' + the first 8 characters of its id. It has
   to fit the 16-character `sound` column a reminder and a habit carry, and
   eight hex characters won't collide among a handful of sounds. The bare 'custom' is
   the key from when there was only one, still sitting in old ui_prefs: it
   means the first sound. A key whose sound is gone plays the default chime.
   ------------------------------------------------------------------ */

export const CUSTOM_MAX_BYTES = 300 * 1024;
/* How many of their own sounds a user may keep. The ONE place to change it on
   this side; the server's is CustomSoundService.MAX_PER_USER, and
   CustomSoundLimitsTest fails the build if the two ever differ. Everything
   that shows or enforces the cap (Alerts, a reminder's "Add your own sound")
   reads this. */
export const CUSTOM_MAX_COUNT = 5;
/* Whatever they picked, a notification is not a song — and a recording stops here too. */
export const CUSTOM_MAX_MS = 5000;

let customs = []; // [{ key, id, name, url }]
let customEl = null;
let customElKey = null;
let customTimer = null;

export function customKey(id) {
  return 'custom:' + String(id).slice(0, 8);
}

export function isCustomKey(key) {
  return key === 'custom' || /^custom:/.test(key || '');
}

/** Hand the stored sounds ([{id, name, dataUrl}], or [] to forget them) to the player. */
export function setCustomChimes(list) {
  customs = (list || [])
    .filter((s) => s && s.id && s.dataUrl)
    .map((s) => ({
      key: customKey(s.id),
      id: s.id,
      name: s.name || 'Your sound',
      source: s.source || null,
      url: s.dataUrl,
    }));
  // Keep the loaded player while its sound is still here, unchanged: the list
  // is re-stored for things like marking an upload synced, a moment after a new
  // sound starts its preview, and dropping the player then cut it off.
  const loaded = customEl && customs.find((c) => c.key === customElKey);
  if (loaded && loaded.url === customEl.src) return;
  if (customEl) {
    try {
      customEl.pause();
    } catch (_) {
      /* ignore */
    }
    customEl = null;
    customElKey = null;
    finishCustom();
  }
}

/** The user's own sounds, in picker order: [{ key, id, name, source }]. */
export function customChimes() {
  return customs.map(({ key, id, name, source }) => ({ key, id, name, source }));
}

function findCustom(key) {
  if (key === 'custom') return customs[0] || null;
  return customs.find((c) => c.key === key) || null;
}

/** Whether a stored tone key still names something playable — a built-in or one of theirs. */
export function isKnownChime(key) {
  return CHIMES.some((c) => c.key === key) || !!findCustom(key);
}

/** A stored tone key as a picker option's value: '' (the default) when its sound is gone. */
export function chimeOptionValue(key) {
  if (!key) return '';
  const c = isCustomKey(key) ? findCustom(key) : null;
  if (c) return c.key;
  return CHIMES.some((x) => x.key === key) ? key : '';
}

/** Every tone a picker can offer: the built-ins, then the user's own, then Silent. */
export function chimeOptions() {
  const builtIn = CHIMES.filter((c) => c.key !== 'off');
  const off = CHIMES.filter((c) => c.key === 'off');
  return builtIn.concat(
    customChimes().map((c) => ({ key: c.key, label: c.name, custom: true })),
    off
  );
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
    // A recorder's blob says 'audio/webm;codecs=opus', and the data URL would
    // carry the parameter along — which the server's audio/<type>;base64 gate refuses.
    const type = String(file.type).split(';')[0];
    r.readAsDataURL(type === file.type ? file : new Blob([file], { type }));
  });
}

export function canRecordChime() {
  return !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    typeof window !== 'undefined' &&
    window.MediaRecorder
  );
}

/**
 * Start recording from the microphone. Resolves once recording has begun (so
 * after the permission prompt) to { stop, cancel, done }. `done` resolves to the
 * data URL when it stops — by stop(), or by itself at CUSTOM_MAX_MS — and to
 * null after cancel(). Every rejection carries a user-facing message.
 */
export async function recordCustomChime() {
  if (!canRecordChime()) throw new Error('This device can’t record audio here.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error(
      err && err.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it for Growth Buddy and try again.'
        : 'Couldn’t reach a microphone.'
    );
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  let rec;
  try {
    rec = new MediaRecorder(stream);
  } catch (_) {
    release();
    throw new Error('This device can’t record audio here.');
  }
  const chunks = [];
  let cancelled = false;
  let cap = null;
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => {
      release();
      clearTimeout(cap);
      if (cancelled) return resolve(null);
      const type = (rec.mimeType || (chunks[0] && chunks[0].type) || '').split(';')[0];
      const blob = new Blob(chunks, { type: /^audio\//.test(type) ? type : 'audio/webm' });
      if (!blob.size) return reject(new Error('Nothing was recorded. Try again.'));
      readCustomChime(blob).then(resolve, reject);
    };
  });
  const stop = () => {
    if (rec.state !== 'inactive') rec.stop();
  };
  cap = setTimeout(stop, CUSTOM_MAX_MS);
  rec.start();
  return {
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
    done,
  };
}

/* Settles the preview in flight, if any (see previewChime). Called on every way
   a custom sound stops: it ended, hit the 5 s cap, failed, was replaced, or
   stopChime(). */
let customDone = null;
function finishCustom() {
  const done = customDone;
  customDone = null;
  if (done) done();
}

function playCustom(key) {
  const c = findCustom(key);
  if (!c) return playChime(DEFAULT_CHIME);
  finishCustom(); // whatever was playing is over, as far as its button knows
  try {
    if (!customEl || customElKey !== c.key) {
      if (customEl) customEl.pause();
      customEl = new Audio(c.url);
      customElKey = c.key;
    }
    const el = customEl;
    el.onended = finishCustom;
    el.onerror = finishCustom;
    el.currentTime = 0;
    el.volume = 0.7;
    el.play().catch(finishCustom); // autoplay refused: nothing is playing
    clearTimeout(customTimer);
    customTimer = setTimeout(() => {
      try {
        el.pause();
      } catch (_) {
        /* ignore */
      }
      finishCustom();
    }, CUSTOM_MAX_MS);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Play a tone and resolve when it has finished — for a button that shows
 * it is playing. A custom sound resolves on its `ended` (or the 5 s cap, or
 * stopChime); a synthesised one after its last note's tail.
 */
export function previewChime(key) {
  return new Promise((resolve) => {
    if (isCustomKey(key) && findCustom(key)) {
      if (!playCustom(key)) return resolve();
      customDone = resolve; // after playCustom, which settles the previous one
      return;
    }
    const notes = SOUNDS[key] || (isCustomKey(key) ? SOUNDS[DEFAULT_CHIME] : null);
    if (!notes || !playChime(key)) return resolve();
    setTimeout(resolve, Math.max(...notes.map((n) => n.t + n.d)) * 1000 + 50);
  });
}

/** Stop a custom sound mid-play. Synthesised ones are under a second; they run out. */
export function stopChime() {
  clearTimeout(customTimer);
  try {
    if (customEl) customEl.pause();
  } catch (_) {
    /* ignore */
  }
  finishCustom();
}

/** Play one of SOUNDS, or one of the user's own. 'off'/unknown → silence. */
export function playChime(key) {
  if (isCustomKey(key)) return playCustom(key);
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
  const rec = await readCustomChime(new Blob(['x'], { type: 'audio/webm;codecs=opus' }));
  console.assert(
    rec.startsWith('data:audio/webm;base64,'),
    'a recording should lose its codecs parameter'
  );
  console.assert(
    customKey('0123456789abcdef').length <= 16,
    'a custom key must fit the 16-char sound column'
  );
}

if (import.meta.env && import.meta.env.DEV) _demo();
