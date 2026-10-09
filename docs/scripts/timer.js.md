# scripts/timer.js — Focus screen

Exports `ScreenFocus(props)`. Pomodoro timer + ambient sound **synthesised live with the Web
Audio API** — no audio files, so zero download weight and no licensing.

## Timer

Module-scope state `T`: `{mode, durationSec, remainingSec, running, intervalId, refs}`.
Module scope on purpose — a running session survives navigating away from the Focus tab. `T.refs`
holds live DOM refs, rebuilt on every mount, so the timer **ticks in place** without re-rendering
the screen every second.

## The clock is the authority, not the tick

`T.endsAt` is a wall-clock instant; `remainingSec` is **derived** from it on every
tick and on every return to the foreground (`visibilitychange`, `focus` → `resync`).
It used to be `remainingSec -= 1` inside a 1s interval — and a backgrounded tab has
that interval throttled to once a minute, while an Android WebView behind a locked
screen stops it dead. A 25-minute session put in a pocket came back with twenty-odd
minutes still on it and never finished. Throttling now changes how often the ring
repaints, never what it says.

`armEndAlarm()` queues the session end with the OS (`scheduleLocalNotifications`,
id **2** — 1 is the push test, and reminder ids start far above both because they are
derived from the minute they fire in), so a phone rings even when the WebView is
frozen. `pause`, `reset` and `setMode` all `cancelEndAlarm()`. That cancel is
`cancelLocalNotifications([id])` from `native.js`, **not**
`cancelPendingLocalNotifications()` — the latter clears the whole queue and would
take every reminder with it.

| Fn |
|---|
| `setMode(mode, mins)` |
| `start` / `pause` / `reset` |
| `paintRing` / `buildRing(size, stroke)` |
| `chime()` |
| `openCustomMinutesModal` |
| `TimerCard` |
| `fmt(s)` / `pad(n)` |

## Sound engine

`SOUNDSCAPES` (34) lists the presets. Graph is built per soundscape and torn down on stop:

| Fn | What |
|---|---|
| `ensureCtx` | lazy `AudioContext` (must be created on a user gesture) |
| `noiseBuffer(ctx, brown)` | white/brown noise buffer |
| `attachLfo(ctx, freq, min, max, param)` | slow modulation for movement |
| `buildGraph(key)` | per-soundscape node graph |
| `stopGraph` | full teardown |
| `playSound` / `stopSound` / `setVolume` / `setSoundEnabled` / `setSoundscape` | |
| `paintSound` / `SoundCard` | UI |

## Stats

`applyStats(s)` (690), `statTile` (697), `StatsCard` (701) — backed by `/api/focus/stats`;
the newest answer is kept in `Focus.last` (cleared when `statsOwner` changes) so a revisit opens on
numbers, not dashes;
completed sessions POST to `/api/focus/sessions` (`FocusSession` rows are retention-capped per user).

Styles: `app.css` §"Focus screen" and §"Focus stats card".
