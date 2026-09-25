/* =====================================================================
   Growth Buddy — render the in-app chimes to .wav

   `node scripts/gen-chimes.mjs`

   The day chime.js's ponytail note pointed at: a notification that arrives
   while the app is closed is drawn by Android, and Android plays a sound from
   a FILE, not from our AudioContext. So the same SOUNDS table gets rendered
   out here, into two places.

   `public/` is the web bundle, which Vite copies verbatim and the plugin can
   resolve a notification's `sound` out of. `res/raw/` in the Capacitor project
   is the one Android's NOTIFICATION CHANNELS can see: a channel's sound may
   only ever be an `android.resource://.../raw/<name>` URI, never a web asset,
   and the sound is the channel's — not the notification's — on Android 8+. We
   have to make those channels ourselves (see native.js: the plugin's own are
   IMPORTANCE_DEFAULT, which rings without ever showing a banner), so the files
   have to exist as raw resources.

   That is also why the names use an underscore: a raw resource name is
   [a-z0-9_] only, and `gb-chime` is not a legal one — it silently resolves to
   nothing. One name in both places, so neither resolver can miss.

   Synthesis mirrors playChime() note for note (sine/triangle, 12 ms attack,
   exponential tail, optional glide). Re-run it after editing SOUNDS; the
   assertions at the end are the check that a typo there produced silence.
   ===================================================================== */

import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS } from './chime.js';

/* 22.05 kHz mono: the highest partial in the table is 1760 Hz, and these ride
   in an APK. 44.1 kHz would double the bytes for nothing audible. */
const RATE = 22050;
const TAIL = 0.05;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public');
/* The Capacitor project is a sibling checkout and may simply not be there (CI,
   a web-only clone). Writing raw resources is then skipped, not fatal — the web
   bundle is the half that matters for `npm run dev`. */
const RAW_DIR = join(ROOT, '..', 'Growth-Buddy-Mobile', 'android', 'app', 'src', 'main', 'res', 'raw');

/* Web Audio's exponential ramps, which is why playChime() floors its gain at
   0.0001 rather than 0 — the curve can't reach zero. */
const expRamp = (from, to, u) => from * Math.pow(to / from, u);

function render(notes) {
  const length = Math.ceil((Math.max(...notes.map((n) => n.t + n.d)) + TAIL) * RATE);
  const out = new Float32Array(length);
  for (const n of notes) {
    const start = Math.round(n.t * RATE);
    const end = Math.min(length, Math.round((n.t + n.d) * RATE));
    // Phase is integrated rather than computed from t, so a glide doesn't jump.
    let phase = 0;
    for (let i = start; i < end; i++) {
      const u = (i - start) / RATE;
      const freq = n.to ? expRamp(n.f, n.to, u / n.d) : n.f;
      phase += (2 * Math.PI * freq) / RATE;
      const wave =
        n.type === 'triangle'
          ? (2 / Math.PI) * Math.asin(Math.sin(phase))
          : Math.sin(phase);
      // 12 ms linear attack, then the exponential tail — playChime()'s envelope.
      const gain = u < 0.012 ? (u / 0.012) * n.g : expRamp(n.g, 0.0001, (u - 0.012) / n.d);
      out[i] += wave * gain;
    }
  }
  return out;
}

/** 16-bit mono PCM. The one format every Android version plays without codecs. */
function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); // PCM header size
  buf.writeUInt16LE(1, 20); // format: PCM
  buf.writeUInt16LE(1, 22); // channels
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    // Clamp rather than wrap: summed notes can overshoot and a wrapped sample
    // is a click, which on a notification sounds like a fault.
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
/* Only when the sibling checkout exists — see RAW_DIR. */
const rawWanted = existsSync(join(ROOT, '..', 'Growth-Buddy-Mobile', 'android'));
if (rawWanted) mkdirSync(RAW_DIR, { recursive: true });

/* A tone deleted from SOUNDS has to lose its file too, or the APK keeps
   shipping a chime nothing can select and Android keeps a channel pointed at
   it. Clear ours first, then write; anything not named gb_*.wav isn't ours. */
for (const dir of rawWanted ? [OUT_DIR, RAW_DIR] : [OUT_DIR]) {
  for (const f of readdirSync(dir)) {
    if (/^gb[-_].*\.wav$/.test(f)) rmSync(join(dir, f));
  }
}

for (const [key, notes] of Object.entries(SOUNDS)) {
  const samples = render(notes);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  // Same two bounds chime.js's _demo() asserts in the browser.
  if (!(peak > 0.01)) throw new Error(`chime ${key} is silent (peak ${peak.toFixed(4)})`);
  if (!(peak < 0.5)) throw new Error(`chime ${key} is too loud (peak ${peak.toFixed(4)})`);
  // A notification competes with a pocket, a room, a bus. The in-app gains are
  // set for a speaker you're already looking at, so lift to a fixed headroom
  // rather than shipping something nobody hears.
  const lift = 0.85 / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= lift;
  const bytes = wav(samples);
  writeFileSync(join(OUT_DIR, `gb_${key}.wav`), bytes);
  if (rawWanted) writeFileSync(join(RAW_DIR, `gb_${key}.wav`), bytes);
  console.log(
    `gb_${key}.wav  ${(samples.length / RATE).toFixed(2)}s  ` +
      `${Math.round((44 + samples.length * 2) / 1024)} kB  (peak ${peak.toFixed(3)} → 0.85)`
  );
}
console.log(
  'gen-chimes.mjs: rendered ' +
    Object.keys(SOUNDS).length +
    ' sounds to public/' +
    (rawWanted ? ' and res/raw/' : ' (no Capacitor checkout — skipped res/raw)')
);
