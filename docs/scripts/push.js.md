# scripts/push.js — notification client + the device alarm queue

Two halves. On the **web** it is Web Push (VAPID key from the server, service-worker subscription).
Inside the **Capacitor app** an Android WebView has no `PushManager`, so it can never register a
subscription and the server can never reach it — the same calls route to on-device local
notifications through `native.js`, and timed reminders / habit reminders / the water nudge are
**queued on the device** by `syncDeviceAlarms`. Pure builders are checked by
`node scripts/push.test.mjs` (which also covers native.js's `idsToCancel`, `versionedChannel`,
`isStaleChannel`, `SILENT_CHANNEL`, `TIMER_ALARM_ID`).

## Permission / subscription (web + native fork)

| Export | What |
|---|---|
| `pushSupported()` | native LocalNotifications, else SW + PushManager + Notification |
| `pushPermission()` | `Notification.permission`, `'denied'` when absent |
| `pushSubscribed()` | native: permission granted; web: an existing `pushManager` subscription |
| `enablePush(api)` | → `'ok'｜'unsupported'｜'unconfigured'｜'denied'｜'error'`. Web: `/api/push/public-key` (no `configured`/`publicKey` → `'unconfigured'`), permission, subscribe, POST `/api/push/subscribe`. Native: the app's own permission sheet ("Growth Buddy", not Chrome) |
| `disablePush(api)` | web: unsubscribe + `/api/push/unsubscribe`. **Native: no-op** — an app can't revoke its own permission; the caller points at the system toggle |
| `pushTestLocal(sound)` | native test notification, id **1**, with the **same** `soundFile` and `channelForTone` a real reminder uses. It used to ignore the tone, so it rang while every real Silent alarm was being dropped. Web tests go through `/api/push/test` |

## Alarm builders (pure)

Horizons: `HORIZON_DAYS` 14, `WATER_HORIZON_DAYS` 3 (a 2-hourly drumbeat would otherwise crowd real
reminders off the end), `MAX_QUEUED` 100. ponytail: an app unopened past the horizon goes quiet.

| Export | What |
|---|---|
| `upcomingReminderAlarms(reminders, now, days, lead)` | expands via `recurrence.js` `occursOn` (same rules the calendar draws). Skips: no `time` (all-day), a `doneDates` hit, an unparseable time (NaN would reject the whole batch). Rings `notifyBefore`, else `lead` (`leadOf`; the user's `reminderLead`, = server `ReminderPrefs.leadFor`); **an early ring already gone falls back to on time**. `notifyBefore2` (`secondLeadOf`) is a second alert — none when equal to the first, no on-time fallback. A future `snoozedUntil` is one more alarm |
| `isQuietAt(quiet, at)` | quiet hours, may wrap midnight, end exclusive. Mirrors `ReminderPrefs.isQuiet`. Holds back **only** water + habit nudges, never a reminder the user timed |
| `usualDrinkHours(times)` | hours with water logged on 60%+ of days (`insights.js` `drinkRateByHour`), needs 5 days. **Not a stored pref** — app.js adds it as `usualHours` per sync |
| `upcomingWaterAlarms(prefs, now, days)` | `WATER_DEFAULTS` `{on, everyMins: 120, from, to}` (= `ui_prefs.water`). 30-minute floor; inverted/empty window → silence; a slot right after a usual hour is dropped. Not recurrence |
| `upcomingHabitAlarms(habits, now, days)` | daily at `reminderTime` regardless of cadence; `doneToday` skips **today only** |
| `upcomingAlarms({reminders, water, habits, sound, lead, quiet}, now)` | merge, quiet-filter, sort, cap, then stamp `id`, `sound`, `channelId` |
| `syncDeviceAlarms(opts)` | native + granted only. `cancelPendingLocalNotifications({keep: [TIMER_ALARM_ID]})` then schedule the whole set. Returns count. Called by app.js `reSyncDeviceAlarms` whenever any input changes |

## Traps

- **Ids come from the minute an alarm fires in** (`floor(ms/60000) * 16`, stepping forward while
  taken), never a queue position. A positional counter handed a rebuilt batch the ids of
  notifications already sitting in the shade, and Android replaced (wiped) them. Queued = future,
  delivered = past, so they can't collide; fits int32 until 2225. Ids 1 (test) and 2 (timer) sit far below.
- **Rebuild whole, keep the timer.** The cancel keeps `TIMER_ALARM_ID` — a re-sync used to kill a
  running focus session's end alarm. Logout cancels with no `keep`.
- **Silent is queued, onto `SILENT_CHANNEL`.** Android takes sound from the channel, so a soundless
  channel rings the system default; the old fix filtered Silent out of the queue entirely and cost the
  user the notification too. `channelForTone('off')` → `SILENT_CHANNEL` (importance 2).
- `soundFile(key)` → `gb_<key>.wav` only for keys in chime.js `SOUNDS`; custom uploads and unknown
  keys get no file and the shared `gb-tone-default` channel (phone's own sound). **Underscore is
  load-bearing** (raw resource names are `[a-z0-9_]`; see `chime.js.md`).
- `channelForTone` goes through native.js `versionedChannel` — never hand-build a channel id.
- A reminder's own `sound` wins; the water nudge never has one, so it follows the default.
