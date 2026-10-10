# scripts/native.js — Capacitor shell helpers

Everything that only means something inside the Capacitor app. **Every export is a no-op on the
web.** Plugins are reached through the bridge, never imported: the plugin packages live in
`../Growth-Buddy-Mobile`, so an import would break the web build. Pure parts are checked by
`node scripts/push.test.mjs`.

## `nativePlugin(name)` — the only way in

`Capacitor.Plugins` is filled by `registerPlugin()` inside each plugin's JS package — not in this
bundle — so in the shipped app it is **always empty** and every lookup used to return null (no
splash control, no device name, "this browser doesn't support push notifications" on a phone).
`nativePlugin` returns a registered plugin if any, else a `Proxy` onto the bridge's own
`Capacitor.nativePromise(plugin, method, opts)`, which reaches the same native class.

- **Promise-style methods only**; a listener would need `nativeCallback` (ponytail).
- The proxy answers `undefined` for `then`, so an accidental `await` on it can't hang forever.
- It exists whether or not the native class does: a missing plugin shows up only as a rejected
  call, so callers wrap in `try` (see share-card.js `shareNatively`). Also used by app.js's
  speech recognition.

## Boot / shell

| Export | What |
|---|---|
| `isNative()` | `Capacitor.isNativePlatform()` |
| `initNative()` | 4 s splash `hide()` backstop (the splash is held open by hand, `launchAutoHide:false`, so a throw before render would strand the user), `pruneStaleChannels()` (not awaited), device model → `deviceLabel` |
| `deviceLabelHeader()` | `"Growth Buddy on <model>"` — sent as `X-GB-Device` for the signed-in-devices list (Chrome redacts the Android UA to "K") |
| `applyNativeStatusBar(theme)` | solid bar (no overlay — the header already reserves the inset) in `--bg`; call on boot **and every theme change**. Capacitor's `DARK` style means a dark bar |
| `hideNativeSplash()` | two rAFs after the first real render |
| `readTodaySteps()` | `@capgo/capacitor-health` (HealthKit / Health Connect) today's total, once, when `openMeasuredCheckin` opens on a Steps habit; app.js fills the box only if empty. Buckets summed (UTC cut). **0 → null**: HealthKit answers 0 rather than saying denied. No sensor/service/listener of ours. Health Connect's sheet links `public/privacy.html` |

## Channels (Android)

Android takes sound, vibration and **whether a banner appears** from the notification's channel, and
freezes all of it at creation (a deleted channel comes back with its old settings). Left alone the
plugin invents `sound_<name>` channels at IMPORTANCE_DEFAULT (3), which rings and **never banners** —
only 4 does. So we create channels ourselves and always pass `channelId`.

| Symbol | What |
|---|---|
| `CHANNEL_VERSION` | 1 = the plain ids already on phones. **To change a channel's sound/importance, bump it**: every id gets `-v<N>` |
| `versionedChannel(base, version)` | the id for a version; push.js `channelForTone` uses it — never hand-build an id |
| `isStaleChannel(id, version)` | ours (`gb-` prefix) and of another version |
| `pruneStaleChannels()` | `listChannels` / `deleteChannel` on stale ones, from `initNative`; never touches non-`gb-` channels |
| `SILENT_CHANNEL` | `gb-silent`, the one channel with no sound: **importance 2** (shade only). Sound is left off — it's importance 2 that keeps it quiet, a soundless channel would take the system default |
| `ensureChannel(LN, id, sound)` | `createChannel` once per id per session (a failure is also remembered — it means the platform has no channels, e.g. iOS). Tone channels: importance 4, named "Reminders · <Tone>" |

ponytail: one version for every channel — a bump re-creates all and resets any user per-channel tweak.

## Local notifications

| Export | What |
|---|---|
| `localNotificationsAvailable()` / `localNotificationPermission()` / `requestLocalNotifications()` | `'granted'｜'denied'｜'prompt'｜'unsupported'` |
| `scheduleLocalNotifications(items)` / `scheduleLocalNotification(item)` | `{id, title, body, at?, sound, channelId}`; no `at` = now. Ids are coerced to int32; same pending id replaces. **`allowWhileIdle: true`** or Doze delivers overnight reminders hours late. `sound` is still passed (iOS / pre-8 Android) |
| `cancelLocalNotifications(ids)` | specific ids — the focus timer drops its own alarm without taking every reminder |
| `TIMER_ALARM_ID` | **2**, the focus timer's end alarm (1 = push test; reminder ids are minute-derived, far above) |
| `idsToCancel(pending, keep)` | pure filter |
| `cancelPendingLocalNotifications({keep})` | the whole pending queue minus `keep`. push.js `syncDeviceAlarms` passes `[TIMER_ALARM_ID]` (a re-sync used to wipe a running session's end alarm); logout passes nothing. Delivered notifications aren't pending, so the shade is never cleared |

ponytail: local only — server-initiated pushes to the app need FCM + `@capacitor/push-notifications`.
