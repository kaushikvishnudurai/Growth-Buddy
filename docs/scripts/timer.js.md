# scripts/timer.js — Focus screen

Exports `ScreenFocus(props)`. Pomodoro timer + ambient sound **synthesised live with the Web
Audio API** — no audio files, so zero download weight and no licensing.

## Timer

Module-scope state `T`: `{mode, durationSec, remainingSec, running, intervalId, cycleDone, link, refs}`.
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
id **`TIMER_ALARM_ID`** = 2, exported from `native.js` — 1 is the push test, and reminder ids
start far above both because they are derived from the minute they fire in; push.js's
`syncDeviceAlarms` re-sync keeps it, it used to wipe it), so a phone rings even when the WebView is
frozen. `pause`, `reset` and `setMode` all `cancelEndAlarm()`. That cancel is
`cancelLocalNotifications([id])` from `native.js`, **not**
`cancelPendingLocalNotifications()` — the latter clears the whole queue and would
take every reminder with it.

## Surviving a reload

`saveSession()` writes `{owner, mode, durationSec, remainingSec, running, endsAt, cycle, link}` to CacheStorage
(`gb.focusSession`, never localStorage) on start / pause / reset / setMode; an idle clock removes it.
`restoreSession()` runs on mount and from app.js's boot (`resumeFocusSession(focusProps())`, after
`CacheStorage.init()`, only when the key exists): another account's session is dropped, a running
one resumes against its `endsAt`, and one that **ended while the app was gone is removed from the
store before it is posted**, so it counts exactly once. The decision is `restoredSession()` in
`scripts/timer-math.js` (DOM-free, with `remainingFrom` and the title helpers), checked by
`node scripts/timer.test.mjs`.

## Around the clock

- A chip tapped mid-session asks first (`switchMode` → `confirmDialog`).
- **The cycle**: four sprints, `T.cycleDone` (0..4) counts the finished ones. A finished sprint lines
  up a 5-minute break, the 4th a 15-minute one; a finished break lines up the last sprint length, and
  the long break starts a new cycle (`afterSession` / `cycleLabel` in timer-math.js — "Sprint n of 4"
  over the heading is `T.refs.cycleEl`). `T.suggest` is the sub line; never auto-started. A session
  that finished while the app was gone advances the cycle too. "Sessions today" is the stats card's count.
- **"Focusing on…"** (`FocusPicker`, a `<select>` of `Focus.targets` = app.js's open tasks and goals):
  `T.link` = `{taskId}` | `{goalId}` | null, read when the session ends and POSTed with it (a break never
  carries one; the server 404s a link that isn't the caller's). A pick that has left the lists stays as
  "The task you picked". A task/goal row's timer button → app.js `startFocusOn(link)` → `focusPreselect`,
  handed once as `props.preselect` (a running sprint is moved over to it, with a toast; an idle break
  becomes a sprint).
- **Daily goal** (`paintGoal` into `Focus.goalEl`, under the buttons): `ui_prefs.focusGoalMins`
  (`props.focusGoalMins`, 0 = off, "Set a daily focus goal" link), a `role=progressbar` bar of today's
  minutes and the server's `goalStreak` (shown only once `stats.goalMinutes` matches the local goal).
  `openGoalSheet` → `setGoal` → `props.onSetFocusGoal` (= `saveUiPrefs`, whose promise it waits on)
  → `Focus.reloadStats`.
- The end rings the user's alert tone (`Focus.chimeKey` = app.js `notifySound()`, via `playChime`;
  the old 880 Hz beep is the fallback) and, on the web, shows a Notification when one is already
  allowed and the tab isn't focused (`notifyEnd`; the service worker's when the constructor throws).
- a11y: the digits are `role="timer"` (implicitly not live); start / pause / end are said once
  through a polite region (`say`). Chips carry `aria-pressed`. Space toggles start/pause when focus
  isn't on a control or in a dialog. Enter submits the custom-minutes sheet (`submitOnEnter`).
- While running the tab title is `"12:34 focus · " + app.js's title`, stripped and re-added each
  tick because app.js retitles on every render (`titleWith` / `stripTitle`).
- `paintRing` rebuilds the start button (and calls `refreshIcons`) only when `running` changes —
  it used to run `lucide.createIcons()` over the whole document every tick.

| Fn |
|---|
| `setMode(mode, mins, suggest)` / `switchMode` (asks first) |
| `saveSession` / `restoreSession` / `resumeFocusSession` (export) |
| `resetFocusSession` (export): app.js `logout()` calls it — clears the interval and OS alarm, stops sound, idles `T`, drops the stored session |
| `start` / `pause` / `reset` |
| `paintRing` / `buildRing(size, stroke)` |
| `chime()` |
| `FocusPicker` / `linkValue` / `cleanLink` |
| `paintGoal` / `openGoalSheet` / `setGoal` |
| `HistoryCard` / `loadHistory` / `paintHistory` / `historyChart` |
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

`applyStats(s)` (also repaints the goal bar), `statTile`, `StatsCard` (`Focus.reloadStats`) — backed by `/api/focus/stats`;
the newest answer is kept in `Focus.last` (cleared when `statsOwner` changes) so a revisit opens on
numbers, not dashes; a failed load says so under the tiles with a Try again;
completed sessions POST to `/api/focus/sessions` (`FocusSession` rows are retention-capped per user).
`FocusService.stats` counts focus sessions only, from the user's local midnight and Monday
(`UserClock`); with a goal it also reads back `STREAK_LOOKBACK_DAYS` for `goalStreak`.
`FocusServiceTest` pins the windows, the clamp, the mode, the zone bucketing, link ownership and the streak.

**History** (`HistoryCard`, between stats and sound): `GET /api/focus/history?days=30`
(`props.getFocusHistory`), re-fetched after every saved focus session. 30 bars in an inline SVG
(`barLayout`, scaled to max(busiest day, goal); the goal is a dashed line; today's bar darker; each
day's full-height hit rect carries a `<title>` tooltip), `aria-hidden`, with a `gb-sr-only` table of
the same days. Under it, this week's minutes per linked task/goal (`week`; a deleted one is "A removed
task"). `History.last` is cleared with `Focus.last` when the owner changes.

Styles: `app.css` §"Focus screen" and §"Focus stats card".
