# scripts/native.js — Capacitor shell helpers

Everything that only means something inside the Capacitor app. **Every export is a no-op on the
web** except `saveFile`, which downloads there. Plugins are reached through the bridge, never imported: the plugin packages live in
`../Growth-Buddy-Mobile`, so an import would break the web build. Pure parts are checked by
`node scripts/push.test.mjs`.

## `nativePlugin(name)` — the only way in

`Capacitor.Plugins` is filled by `registerPlugin()` inside each plugin's JS package — not in this
bundle — so in the shipped app it is **always empty** and every lookup used to return null (no
splash control, no device name, "this browser doesn't support push notifications" on a phone).
`nativePlugin` returns a registered plugin if any, else a `Proxy` onto the bridge's own
`Capacitor.nativePromise(plugin, method, opts)`, which reaches the same native class.

- **Promise-style methods only.** The listeners, `onLocalNotificationAction(cb)` (and `onNativeChanges(cb)`, the same way), call
  `cap.nativeCallback('LocalNotifications', 'addListener', {eventName}, cb)` itself (what a
  registered plugin's `addListener` does). `registerNotificationActions(types)` writes the button
  sets; `scheduleLocalNotifications` passes each item's `actionTypeId` + `extra`. On iOS a press opens the
  app (actions are `foreground`), and the plugin holds the event until a listener attaches, so a
  press that cold-starts the app still arrives. **On Android a press never opens the app**: the
  mobile repo patches the plugin (`patches/`) to broadcast it to `NotificationActionReceiver`, which
  makes the same API call natively with the token `setNativeAuth(token, base)` mirrored (from
  `saveSession` and boot; `clearNativeAuth` in `clearSession`), re-posts a snoozed card at
  `snoozedUntil`, and sets a flag: `takeNativeChanges()` on resume, or the live `onNativeChanges`
  event, makes app.js `loadData()`. An APK without the receiver falls back to opening the app.
- The proxy answers `undefined` for `then`, so an accidental `await` on it can't hang forever.
- **A plugin the binary wasn't built with returns null.** Both platforms set
  `Capacitor.PluginHeaders` (one `{name, methods}` per native plugin) before the page runs; a name
  not in it gets null, not a proxy. Before that a missing plugin was a truthy proxy whose every call
  rejected: the iOS build (no speech plugin in SPM) showed a mic that always failed, and every
  `readTodaySteps` made a doomed native call. Callers still wrap in `try` — an installed plugin
  can reject too (see `saveFile`). Also used by app.js's speech recognition (`voiceSupported`).

## `saveFile(data, filename, mime, title)` — every file the app hands out

Story cards (share-card.js), Download my data, the reminders .ics and the money CSV all go through it.
A Capacitor WebView drops `<a download href=blob:>` silently (no download handler), so **native** writes
the bytes with `Filesystem.writeFile` (bare base64, `directory: 'CACHE'`) and opens
`Share.share({files: [uri]})`: needs **`@capacitor/filesystem` + `@capacitor/share`** in the mobile
package.json (and `cap sync`). **Web**: an `image/*` goes to `navigator.share({files})` where
`canShare` says yes, everything else (and that fallback) is a plain download. Resolves `'shared'`
(a sheet took it; a dismissed sheet counts) or `'saved'` (a download started). On native a failed
write or share **rejects** with a user-facing message, so call sites toast "downloading" only on
`'saved'` and let their `catch` show the error. Checked by `e2e/native-parity.spec.mjs`.

## Boot / shell

| Export | What |
|---|---|
| `isNative()` | `Capacitor.isNativePlatform()` |
| `initNative()` | `pruneStaleChannels()` (not awaited), device model → `deviceLabel`. **The splash backstop is not here any more**: this runs at the end of app.js, so a throw earlier (e.g. `resolveApiBase()` on a bundle built without `VITE_API_BASE`) never armed it. `public/global-shim.js` arms it before app.js: hide at 4 s, or at once on an uncaught `error` |
| `publicSiteUrl()` | the public web address, no trailing slash: `location.origin` in a browser, `VITE_API_BASE` in the app (the page is `https://localhost` there; the backend serves the same SPA). For links meant for someone else: Circle invites (`challengesApi.siteUrl`), the privacy link, save-file.js's "Open website" |
| `deviceLabelHeader()` | `"Growth Buddy on <model>"` — sent as `X-GB-Device` for the signed-in-devices list (Chrome redacts the Android UA to "K") |
| `applyNativeStatusBar(theme)` | solid bar (no overlay — the header already reserves the inset) in `--bg`; call on boot **and every theme change**. Capacitor's `DARK` style means a dark bar. **Each call in its own try**: iOS has no `setBackgroundColor` and Android 15+ ignores the first two (edge-to-edge), and one rejection used to skip `setStyle`, leaving the icon colour wrong |
| `deepLinkHash(url)` | pure: the link's `#/route?query`, null when it names no route |
| `onDeepLink(cb)` | App plugin: `getLaunchUrl` (cold start) + `appUrlOpen` (already running, via `Capacitor.addListener`). app.js writes the hash to `location.hash`. The intent-filter / Associated Domains that make the OS hand links over are in `docs/mobile-native-changes.md` |
| `hideNativeSplash()` | two rAFs after the first real render |

## Health (HealthKit / Health Connect, read only)

`@capgo/capacitor-health`. **Only `requestHealthAccess()` opens a permission sheet**; every read just
reads (Health Connect throws without access, HealthKit answers empty — both become null), so the
boot-time reads can never pop a dialog. The mobile manifest keeps READ_* for exactly `HEALTH_READ`.

| Export | What |
|---|---|
| `HEALTH_READ` | the 15 types the Health screen shows. **Adding one = a READ_* kept in the mobile manifest** (+ a Play justification line in MOBILE.md), or Health Connect silently returns nothing |
| `healthAvailable()` / `requestHealthAccess()` | store reachable (false on an APK without the plugin) / the OS sheet for all of `HEALTH_READ` |
| `readTodaySteps()` | today's total; still asks for `steps` itself (Steps habits predate the setup step). **0 → null**: HealthKit answers 0 rather than saying denied |
| `nightFromSamples(samples, dayKey)` | pure: the night that **ended** on `dayKey` (sleep is keyed on the wake date) → `{bedtime, wakeTime, minutes}`. Stages/sessions merged across gaps ≤ 90 min, awake left out, longest 3 h+ run wins (a nap is never "last night"). `node scripts/health.test.mjs` |
| `readHealthValue(link)` | today's reading for a habit link in its unit (steps, km, kcal, floors, workout minutes); `sleep` is not here — it comes from the sleep entry |
| `readLastNight()` | `readSamples('sleep')` from noon yesterday → `nightFromSamples` |
| `readHealthForSync(days = 7)` | rows for `POST /api/health/sync`: per local day, sums of steps / distance (km) / active kcal / floors (one aggregate query per type per day, buckets added — UTC cuts), workout minutes (note = the kinds), and the newest reading of each day for resting HR, HRV, SpO2, breathing rate, weight, height, body fat, BP (`value2` = diastolic). Percent types normalised (HealthKit 0-1). The server upserts one phone row per type per day, so re-sending a day overwrites it. Health Connect returns only 30 days before the first grant without `READ_HEALTH_DATA_HISTORY` (not requested) |

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
