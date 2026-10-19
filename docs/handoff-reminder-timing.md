# Handoff: phone reminders ring late on OnePlus (own sound already works)

Next session: **only this**. Supersedes the open question in `handoff-custom-sound.md`: the own sound
plays; the remaining problem is **when** the alarm fires.

## Session 2 (2026-10-19, Windows): fix written, needs a Mac build

The mobile repo now has versionCode 12's source (`beb9a91`, pulled from origin). Change is in
`Growth-Buddy-Mobile`, **versionCode 13**, not yet built or pushed. No web code changed.

Findings:
- **Battery "Unrestricted" does not help.** App on the deviceidle user whitelist, then test 990003
  (2.5 min lead, screen off): `window=+1m52s480ms`, due 12:46:45.85, `sending alarm` 12:47:42.35
  (**+56.5 s**). No Hans freeze this time, but the window is unchanged. The
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` prompt was written and reverted for that reason.
- **OnePlus spares some apps by package.** Same dump: Zoho Calendar (targetSdk 35,
  SCHEDULE_EXACT_ALARM, not battery-exempt) and Google Calendar (37, USE_EXACT_ALARM) get `window=0`
  with `flags=0x5` (plain setExactAndAllowWhileIdle, no alarm icon). Growth Buddy, WhatsApp, OnePlus
  Gallery and even `com.oplus.eyeprotect` get up to `+1h`. Not permission, targetSdk or battery: an
  OEM list we can't join (not found in readable system files).
- **The window is 75% of the lead at the moment the alarm is set** (the 13:30 alarm's window shrank
  59 m, 51 m, 36 m, 30 m with each re-sync).
- **Side bug below is not a bug.** `gb-tone-custom-27ca809b-r2` has `mDeleted=true`, deleted
  12:10:56 by `pruneCustomChannels`; `dumpsys notification` lists soft-deleted channels.
  `LN.listChannels()` does not show it.

The fix (user chose it over an always-on alarm icon): `GbOnTime.kt`, added by
`patches/@capacitor+local-notifications+8.3.1.patch` (action-button hunk kept). For a one-shot exact
`at` with `allowWhileIdle`: hop alarms (`setExactAndAllowWhileIdle`) placed so their latest delivery
(hop + min(75% of lead, 1 h)) lands 1 min before due; each hop re-arms closer; within 5 min of due
it becomes `setAlarmClock(due)`, so the icon shows for those 5 minutes only. The receiver
(`TimedNotificationPublisher`) posts nothing on a hop. Same PendingIntent throughout, so cancel and
reboot restore are unchanged. Logs under tag `GbOnTime` (`hop at`, `alarm clock for`, `posted at ...
(N ms)`). iOS untouched: the OS delivers on time (it keeps only the soonest 64 pending).

On the Mac: `git pull` in Growth-Buddy-Mobile, `npm install` (applies the patch), build and install
versionCode 13, then run Acceptance below. Expect `adb logcat -s GbOnTime` to show the hops and a
`posted at` within about 1 s of due. Not compiled yet (no SDK on the PC): first build may need a fix.

## Status (2026-10-19, diagnosed on Windows with adb, no code changed)

Phone: OnePlus Nord 3 5G (CPH2491), Android 16 / SDK 36, serial `XCYXXO9H7DGU4TY5`.
Installed: `com.growthbuddy.app` **versionCode 12**, web build 113 (`main` @ `167fb18`), debug build,
fresh install 2026-10-19 12:00. **The mobile repo on the Windows PC stops at versionCode 11
(`f1b702a`)**: find where 12 was built (the Mac?) and work from that source.

### Proven on the device

Test: reminder id 990002 scheduled from inside the app's WebView (method below), at = 12:28:44,
`channelId: gb-tone-custom-9b2bf9cb-r2`, `allowWhileIdle: true`, phone locked, screen off.

| Time | logcat |
|---|---|
| 12:26:47 | `OplusHansManager: freeze uid 10453 com.growthbuddy.app ... scene: LcdOff` |
| 12:28:44 | (due; nothing happens) |
| 12:29:44.74 | `OplusHansManager: unfreeze ... reason: Alarm`; `AlarmManager: sending alarm ... windowLength 89682` |
| 12:29:44.84 | `PostNotification : {channel_name=Reminders · Recording 1, importance=4 ...}` |
| 12:29:44.95 | `RingtonePlayer(com.android.systemui): play uri=content://com.growthbuddy.app.fileprovider/gb_sounds/gb-tone-custom-9b2bf9cb-r2.webm` |
| 12:29:45.69 | `MediaPlayer start called`, `CCodecConfig: read media type: audio/opus`, AudioTrack created. No error. |

So: **own sound plays, 61 s late.** The old suspect list is closed:

1. Wrong process granted: **ruled out.** On this phone the player is `com.android.systemui`
   (`RingtonePlayer`, pid 2975), which is exactly who `CustomNotificationSoundPlugin` grants.
2. Bytes not on the phone: ruled out (`files/gb_sounds/gb-tone-custom-9b2bf9cb-r2.webm`, 72,816 B).
3. Plugin rejected and swallowed: ruled out (channel exists with the content URI, alarms use it).
4. Format: webm/Opus **plays**. Uploaded mp3/wav still untested.
5. Stale channel: none. But see "Side bug" below.
6. Reminder not using own sound: ruled out; every queued alarm in `NOTIFICATION_STORE.xml` has
   `channelId: gb-tone-custom-9b2bf9cb-r2`.

### The actual problem: every alarm gets a delivery window

`adb shell dumpsys alarm` for every Growth Buddy alarm:

```
type=RTC_WAKEUP origWhen=2026-10-19 13:30:00.000 window=+59m10s exactAllowReason=policy_permission flags=0x4
type=RTC_WAKEUP origWhen=2026-10-19 12:28:44.647 window=+1m29s682ms exactAllowReason=policy_permission flags=0x4
```

Another app's exact alarm in the same dump: `window=0 exactAllowReason=policy_permission`.
Window = 75% of lead time, capped at 1 h, which is the inexact heuristic. A 13:30 water reminder can
ring at 14:29. That is what "doesn't ring" looks like to the user.

Not the JS and not the permission:
- `LN.checkExactNotificationSetting()` → `{exact_alarm: "granted"}` (`USE_EXACT_ALARM` granted).
- Plugin 8.3.1 `LocalNotificationManager.kt` `setExactIfPossible` takes the exact branch
  (`setExactAndAllowWhileIdle(RTC_WAKEUP, ...)`); its "Exact alarms not allowed" warning never logged.
- AOSP only computes `exactAllowReason` for exact alarms, so the system took it as exact. The window
  is added on top, almost certainly by ColorOS/OxygenOS alarm alignment, plus Hans freezing the app
  on screen-off (it is unfrozen only when the alarm is finally sent).
- `am get-standby-bucket` = 10 (ACTIVE), not on the deviceidle whitelist.

## The fix

Schedule one-shot reminders with **`AlarmManager.setAlarmClock()`**. Alarm-clock alarms are
exempt from Doze and from OEM batching (it is what clock apps use). Cost: the status bar shows the
alarm icon while one is queued, and the lock screen may show "next alarm". Accept that, or
apply it only to user-timed reminders (see Options).

Where: extend the existing `Growth-Buddy-Mobile/patches/@capacitor+local-notifications+8.3.1.patch`
(today it only patches action buttons, hunk at `@@ -251`). Add a hunk in
`LocalNotificationManager.kt` `setExactIfPossible`, exact branch:

```kotlin
if (useExact) {
    if (schedule.allowWhileIdle()) {
        // Growth Buddy patch: OEM alarm alignment (OnePlus/ColorOS) adds up to a 1 h window to
        // setExactAndAllowWhileIdle. An alarm clock is never batched or deferred by Doze.
        val show = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val showPi = PendingIntent.getActivity(context, localNotification.id ?: 0, show,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, showPi), pendingIntent)
    } else {
        alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent)
    }
}
```

Notes:
- Generate the patch with `npx patch-package @capacitor/local-notifications` after editing
  `node_modules` (on Windows: `npm install` first, the PC has no `node_modules` in the mobile repo).
  Keep the existing action-button hunk.
- `setAlarmClock` needs exact-alarm permission: already declared and granted (`USE_EXACT_ALARM`).
- Cancel still works: `cancel()` cancels the same broadcast PendingIntent.
- `schedule.on` (cron-style) also goes through `setExactIfPossible`, so it gets the fix too.
  `schedule.every` / repeating `at` use `setRepeating(RTC)`, which is inexact by design; native.js
  only sends one-shot `at` (`scheduleLocalNotifications`, `schedule: { at, allowWhileIdle: true }`).
- Options if the alarm icon is unwanted: add an `extra.alarmClock: true` flag from `push.js`
  `syncDeviceAlarms` for user-timed reminders only, and leave water/habit nudges on
  `setExactAndAllowWhileIdle`. Ask the user which they prefer before building it.
- Cheaper thing to try first (no rebuild): App info → Battery → **Unrestricted** for Growth Buddy,
  reschedule, check `dumpsys alarm` windows. If the windows go to 0, the app should also ask the
  user for it (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) on OEMs that batch. Record the result either way.

Bump `versionCode` in `android/app/build.gradle` (to 13, or one above whatever 12's source is) and
`BUILD` in web `vite.config.js` if web changes.

## Side bug: orphan channel

`gb-tone-custom-27ca809b-r2` ("Reminders · Recording 1") exists with sound
`content://.../gb_sounds/gb-tone-custom-27ca809b-r2.webm`, but **that file is gone** and no alarm uses
it. `usagestats` shows the very first Test notification (12:10:43) went out on that channel, the
next two on `9b2bf9cb`. Two sounds both named "Recording 1" (one re-recorded?). `pruneCustomChannels`
(`native.js`, called from `push.js` with `customChimes().map(customChannel)`) did not delete it, so
either 27ca809b is still in the user's custom-sound list or the prune missed it. Check the list on
server and device, then why the file was removed but the channel was not. A channel whose file is
missing plays nothing, so this can produce a silent alert.

## How to test automatically (no tapping on the phone)

The installed APK is debuggable, so its WebView exposes DevTools over adb:

```sh
adb shell "cat /proc/net/unix | grep -a webview_devtools"     # -> @webview_devtools_remote_<pid>
adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
curl http://127.0.0.1:9333/json/list                           # page + webSocketDebuggerUrl
```

`cdp.mjs` (run with `node --experimental-websocket cdp.mjs "<js body>"`; Node 20 needs the flag):

```js
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id === 1) { console.log(JSON.stringify(m.result, null, 1)); ws.close(); }
});
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
  expression: `(async()=>{${process.argv[2]}})()`, awaitPromise: true, returnByValue: true } }));
```

Schedule a test 2 minutes out on the own-sound channel:

```js
const LN = Capacitor.Plugins.LocalNotifications; const at = new Date(Date.now() + 120000);
await LN.schedule({ notifications: [{ id: 990003, title: 'GB timing test', body: 'due ' + at.toLocaleTimeString(),
  channelId: 'gb-tone-custom-9b2bf9cb-r2', schedule: { at, allowWhileIdle: true } }] });
return at.toString();
```

Then: `adb shell dumpsys alarm | grep -A2 com.growthbuddy` (look at `window=`; the fix makes it an
alarm-clock entry with no window), and grep a running `adb logcat -v time` capture for
`sending alarm.*growthbuddy`, `PostNotification.*Reminders`, `RingtonePlayer.*play uri`.

Gotchas seen:
- If the screen is off and Hans has frozen the app, the DevTools socket can hang. `adb shell monkey
  -p com.growthbuddy.app -c android.intent.category.LAUNCHER 1` wakes it; then evaluation works even
  while locked.
- Keep the logcat capture running past the end of the alarm window, or you miss the fire.
- PIDs change when the app restarts; re-read the socket name.

## Acceptance (real phone, record actual fire time vs due time)

For a reminder 2 min out on the own sound, measure `sending alarm` time minus due time:
1. App in foreground → within a few seconds, own sound.
2. App backgrounded, screen off, locked → within a few seconds (was +61 s; for a 1 h+ lead it was
   up to +59 min).
3. App swiped from recents. On OnePlus this may force-stop the app, which **cancels all alarms**:
   check `dumpsys alarm` after swiping and `dumpsys package com.growthbuddy.app | grep stopped=`.
   If alarms vanish, that is a separate problem (document it; the fix is user-side "allow background
   activity" / auto-launch, or re-queue on next open).
4. Reboot, don't open the app → does the queued reminder ring? (`BOOT_COMPLETED` re-queue.)
5. Uploaded mp3 and uploaded wav as the own sound (only webm verified so far).
6. A 1 h+ lead reminder (the real case): set one ~70 min out and check `dumpsys alarm` shows no
   window, then that it fires on the minute.
7. Built-in tones and Silent unchanged; Settings → Test notification unchanged.

Docs to update if code changes: `docs/scripts/native.js.md` (scheduling section),
`docs/scripts/push.js.md` if an `alarmClock` flag is added, and close out `handoff-custom-sound.md`.

## Constraints

- No emoji anywhere. Persist to DB, not localStorage. Commit as kaushikvishnudurai@gmail.com.
- Ask before pushing the mobile repo anywhere (it has no remote) and before creating a GitHub repo.
- Windows PC: adb at `C:\platform-tools\adb.exe` (not on PATH); **no Android SDK**, so APKs build on
  the Mac (or install the SDK first and say so).
- Remove test notifications ids 99000x if any are still pending (`LN.cancel`).
