# scripts/chime.js — notification sounds

The built-in tones are **synthesised** from a table of oscillator notes (`SOUNDS`) — no audio files,
nothing to licence, nothing in the bundle or APK — plus up to 5 of the user's own sounds (upload or
voice recording). Picker is Settings → Alerts; also used by the focus timer's end chime.

## Built-ins

| Symbol | What |
|---|---|
| `SOUNDS` | `{key: [{f, t, d, g, type?, to?}]}` — Hz, start s, decay s, peak gain, oscillator type, glide target. Seven tones: bloom, droplet, chime, marimba, hush, alarm, buzz. Adding one is a row, not a code path |
| `CHIMES` | picker order + label + hint; includes `off` ("Silent") as a real choice |
| `DEFAULT_CHIME` | `'bloom'` |
| `audio()` | one lazy `AudioContext` per tab, `resume()` on every play (autoplay policy may swallow the first sound before any gesture — not fixable here) |
| `playChime(key)` | schedules the notes; `'off'` / unknown → `false`, plays nothing. Custom keys delegate to `playCustom` |
| `_demo()` | Vite DEV only: renders each sound in an `OfflineAudioContext` and asserts peak in (0.01, 0.5); checks the file gate and that `customKey` fits 16 chars |

**`SOUNDS` is also the phone's notification sound.** `node scripts/gen-chimes.mjs` renders it to
`gb_<key>.wav` in **both** `public/` and `../Growth-Buddy-Mobile/android/app/src/main/res/raw/`
(same silent/clipping bounds as `_demo`, and it deletes the wav of a tone removed from `SOUNDS`), so
in-app and lock-screen chimes can't drift. **Edit `SOUNDS` → re-run the generator.** res/raw exists
because an Android channel's sound can only be a raw resource, and native.js builds the channels.
**The underscore is load-bearing**: a raw resource name is `[a-z0-9_]` only, and `gb-chime`
resolves to nothing with no error. push.js `soundFile` builds the same name.

## The user's own sounds

| Symbol | What |
|---|---|
| `CUSTOM_MAX_BYTES` (300 kB) / `CUSTOM_MAX_COUNT` (5) / `CUSTOM_MAX_MS` (5 s) | caps. `CUSTOM_MAX_COUNT` must equal server `CustomSoundService.MAX_PER_USER` — `CustomSoundLimitsTest` fails the build otherwise. Playback and recording both stop at 5 s |
| `customKey(id)` / `isCustomKey(key)` | key = `'custom:'` + first 8 chars of the id — **must fit the 16-char `sound` column** on reminders and habits. Bare `'custom'` is the pre-library key and means the first sound |
| `setCustomChimes(list)` | `[{id, name, dataUrl, source}]` → player list. **Keeps the loaded `Audio` when its sound is unchanged** — the list is re-stored a moment after a new upload starts previewing, and dropping the player cut it off |
| `customChimes()` / `chimeOptions()` | the user's sounds / every picker's options (built-ins, then custom, then Silent) |
| `isKnownChime(key)` / `chimeOptionValue(key)` | a key whose sound is gone → `''` (default) in pickers; it plays the default chime |
| `readCustomChime(file)` | gate: `audio/*` and ≤ 300 kB, user-facing error messages. **Strips a `;codecs=` parameter** (a recorder's `audio/webm;codecs=opus`) — the server's `audio/<type>;base64` gate refuses it |
| `canRecordChime()` / `recordCustomChime()` | MediaRecorder → `{stop, cancel, done}`; `done` → data URL, `null` after cancel. Android app also needs `RECORD_AUDIO` in its manifest |
| `previewChime(key)` / `stopChime()` | preview **resolves when the sound ends** (custom: `ended`/cap/stop via `finishCustom`; synthesised: last note's tail) — what the Alerts rows' Pause/equalizer state waits on |

Storage (done by app.js, described here): the **choice** in `ui_prefs.notifySound`; the **bytes** in
CacheStorage per device (`gb.notifySound.<id>` behind an index at `gb.notifySounds`) and on the
account (`/api/notifications/custom-sounds`) — never in ui_prefs, which rides on every `/api/auth/me`.

ponytail: a custom upload stays in-app. Android can only ring a file that shipped with the APK;
`CustomNotificationSoundPlugin` exists in the Capacitor project but is **not registered** (empty
`BridgeActivity`), so an upload falls back to the phone's sound. Don't write a second plugin.
