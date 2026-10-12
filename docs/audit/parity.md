# Audit: web vs app parity, Capacitor shell

Scope: `scripts/` (branch feat/overhaul) against `../Growth-Buddy-Mobile` (Capacitor 8, Android
targetSdk 36 / minSdk 24, iOS 15). Static reading only. Every item was checked against the code
or the installed plugin source in `Growth-Buddy-Mobile/node_modules` and the merged debug manifest
(`android/app/build/intermediates/merged_manifests/debug/...`).

Installed native plugins (Android): speech-recognition (community, v7), app, browser, device,
local-notifications, splash-screen, status-bar, plus the in-module CustomNotificationSound.
iOS SPM: the same minus speech-recognition.

Summary: 0 Critical, 6 High, 9 Medium, 6 Low.

---

## High

### P1. A boot-time throw leaves the user on the splash forever
- Severity High, effort S
- `scripts/app.js` module top level; `scripts/native.js` `initNative`
- `launchAutoHide: false` means only JS hides the splash. The 4 s backstop lives inside
  `initNative()`, which is called near the very end of app.js (just before `render()`). Anything
  that throws earlier in module evaluation never reaches it: `resolveApiBase()` (line ~189, throws
  on a native build without `VITE_API_BASE` - MOBILE.md records this exact incident), any of the
  ~30 static imports failing to evaluate, or a top-level call before boot. The user sees an orange
  screen with no way out.
- Fix: arm the backstop before app.js loads, e.g. in `public/global-shim.js`:
  `setTimeout(() => window.Capacitor?.nativePromise?.('SplashScreen','hide',{}), 4000)`, plus a
  `window.onerror` that hides it at once.

### P2. Circle invite links shared from the app point at `https://localhost`
- Severity High, effort S
- `scripts/circle.js` `shareInvite` -> `scripts/circle-core.js` `inviteLink(window.location.href, c)`
- In the app `location.href` is `https://localhost/#/...` (`androidScheme: https`; iOS
  `capacitor://localhost`). The copied link is `https://localhost/#/circle?join=CODE`, which opens
  nothing on the recipient's device. Every invite sent from a phone is dead.
- Fix: when `isNative()`, build the link from the public web origin (a `VITE_PUBLIC_URL`, or
  `API_BASE` since the backend serves the SPA) instead of `location.href`.

### P3. Cold start offline in the app shows the crash card on every screen
- Severity High, effort M
- `scripts/app.js` `loadData` (catch sets `state.error`), boot block that deletes `gb-api-get`
- The web survives an offline cold start because the service worker answers wave-1 GETs from
  `gb-api-get`. The app has no worker (and deletes that cache at boot), and `tasks` / `habits` /
  `goals` / `reminders` are not cache-backed, so wave 1 rejects and `render()` paints
  `CrashCard` in place of Home. The offline outbox exists but no screen renders to write into it.
  Same for a Render cold start that times out at the WebView.
- Fix: persist the last good wave-1 payload to CacheStorage on success and, on a network failure
  with no `err.status`, paint from it with the offline banner instead of `state.error`.

### P4. Recording a custom sound is always refused on Android
- Severity High, effort S
- `scripts/chime.js` `recordCustomChime` (getUserMedia audio); Capacitor
  `BridgeWebChromeClient.onPermissionRequest`
- For `AUDIO_CAPTURE` Capacitor requests `RECORD_AUDIO` **and** `MODIFY_AUDIO_SETTINGS`, and
  grants only if every entry is granted. `MODIFY_AUDIO_SETTINGS` is declared nowhere (merged
  manifest: INTERNET, USE_EXACT_ALARM, RECORD_AUDIO, boot, wake lock, POST_NOTIFICATIONS,
  SCHEDULE_EXACT_ALARM), so the request returns false without a prompt. The user is told
  "Microphone access is blocked. Allow it for Growth Buddy" - and there is nothing to allow.
- Fix: add `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>` to
  `android/app/src/main/AndroidManifest.xml`.

### P5. Every file export in the app reports success and saves nothing
- Severity High, effort M
- `scripts/app.js` `downloadMyData` and the reminders `.ics` export; `scripts/money.js`
  `downloadLedgerCsv`; `scripts/share-card.js` `shareStoryCard` / `shareNatively`
- All fall back to `<a download href=blob:...>`. Capacitor's WebView sets no `DownloadListener`
  (none in `@capacitor/android`), so the click does nothing - then the toast says "Your data is
  downloading" / "calendar file is downloading" / "money CSV is downloading". `canShare({files})`
  is false in the WebView. `shareNatively` needs `Filesystem` + `Share`, neither installed, so the
  story card also lands on the dead download. "Download my data" is the account-deletion escape
  hatch and is unreachable on the phone.
- Fix: add `@capacitor/filesystem` + `@capacitor/share` to the mobile package.json and route all
  four through one `saveOrShareFile(blob, name)` (the `shareNatively` path, generalised); keep the
  toast only for the path that actually saved.

### P6. iOS: no camera usage string - taking a photo crashes the app
- Severity High, effort S
- `Growth-Buddy-Mobile/ios/App/App/Info.plist`; callers `scripts/app.js` (food photo,
  `capture: 'environment'`, barcode `getUserMedia({video})`), `scripts/money.js` (receipts),
  `scripts/family.js`, `scripts/notes.js`
- Info.plist has only microphone and speech strings. WKWebView's camera option for
  `<input type=file accept=image/*>` and `getUserMedia({video})` both need
  `NSCameraUsageDescription`; without it iOS terminates the process on first camera access.
- Fix: add `NSCameraUsageDescription` (and `NSPhotoLibraryAddUsageDescription` if anything ever
  saves to Photos).

---

## Medium

### P7. Hardware back ignores the bell, profile and More panels and popovers
- Severity Medium, effort S
- `scripts/gb-kit.js` back-button listener / `liveOverlays`; `scripts/app.js`
  `toggleNotifOpen` / `toggleProfileOpen` / `toggleMoreOpen`, the popover block (`popoverCleanup`)
- Only `openOverlay` sheets and `trackOverlay` surfaces join the back stack. With the bell or
  More open on Home after a cold start, `canGoBack` is false so back minimises the app with the
  panel still up; on any other screen back navigates to the previous screen instead of closing
  the panel.
- Fix: call `trackOverlay({ close })` when a panel or popover opens and the returned untrack on
  close, as Family's panels already do.

### P8. No deep links or app links: invites and shared URLs never open the app
- Severity Medium, effort M
- `android/app/src/main/AndroidManifest.xml` (only MAIN/LAUNCHER); no `appUrlOpen` listener in
  `scripts/`
- Even with P2 fixed, `.../#/circle?join=CODE` opens in the browser; `inviteFromHash` only ever
  sees the WebView's own hash. Nothing routes an incoming URL into `setScreen`.
- Fix: add an `autoVerify` https intent-filter for the web host (+ `assetlinks.json` from the
  backend) and iOS Associated Domains; in JS, `cap.addListener('App','appUrlOpen', e =>
  location.hash = new URL(e.url).hash)`.

### P9. Tapping a notification does not route anywhere
- Severity Medium, effort S
- `scripts/app.js` `handleNotificationAction` (`act === 'tap'` returns early); `scripts/push.js`
  builders set `extra {kind,id,day}`
- On the web the service worker opens the relevant screen. In the app a tap on a reminder,
  habit or water notification just foregrounds whatever screen was last open.
- Fix: for `tap`, `setScreen` by `extra.kind` (reminder -> calendar on `extra.day`, habit ->
  habits, water -> home).

### P10. The app receives no server-initiated notifications at all
- Severity Medium, effort L
- `scripts/push.js` `enablePush` native branch; `scripts/native.js` ponytail note
- Mentor replies, Circle / Family events, the digest and Buddy's evening reflection are Web Push
  only. The app's push toggle reports "Notifications on" and Settings > Alerts shows
  "Notify me about People / Money" switches that do nothing in the app while it is closed.
- Fix: until FCM + `@capacitor/push-notifications` exist, label those rows "web only" in the app
  (`isNative()`); the real fix is the FCM job already marked ponytail.

### P11. Android 15+: status-bar colour and overlay calls are no-ops
- Severity Medium, effort S
- `scripts/native.js` `applyNativeStatusBar`
- `@capacitor/status-bar` 8 documents `setOverlaysWebView` and `setBackgroundColor` as "not
  available on Android 15+" (edge-to-edge is enforced at targetSdk 36). Capacitor 8's core
  `SystemBars` then either passes insets to the page (new WebView: `env()` works, header pads
  itself) or pads the WebView's parent, whose background comes from `AppTheme.NoActionBar`
  (DayNight, `android:background @null`) - it follows the phone, not the in-app theme, so a
  dark-themed app on a light phone gets a light strip with light icons (`setStyle('DARK')`).
- Fix: on 15+ rely on `SystemBars.setStyle` and set the window background colour natively to
  `--bg` (or use `insetsHandling: 'css'` and pad with `var(--safe-area-inset-top)`).

### P12. iOS: voice input is shown but always fails
- Severity Medium, effort S
- `scripts/app.js` `voiceSupported`, `listenOnce`, Quick add mic; `ios/App/CapApp-SPM/Package.swift`
- `@capacitor-community/speech-recognition` 7.0.1 ships a podspec, no `Package.swift`, so the SPM
  iOS project does not include it. `nativePlugin()` still returns a truthy Proxy, so the mic
  button renders, and every tap rejects into "Didn't catch that - try speaking again."
- Fix: install an SPM-capable version (or add CocoaPods), or have `voiceSupported` probe
  `capSR.available()` once and cache the answer.

### P13. Barcode scanner can never get the camera on Android
- Severity Medium, effort S
- `scripts/app.js` `openBarcodeScanner`; manifest has no `CAMERA`
- Where the WebView exposes `BarcodeDetector`, `getUserMedia({video})` makes Capacitor request
  `CAMERA`, which is undeclared, so it is denied without a prompt and the sheet says "Camera
  permission was refused". (File-input capture still works because Capacitor skips the runtime
  check when CAMERA is undeclared.)
- Fix: declare `android.permission.CAMERA` (file-input capture then prompts once, which Capacitor
  already handles), or hide the scan button when `isNative()`.

### P14. Notifications show the generic Android info icon
- Severity Medium, effort S
- `capacitor.config.json` (no `LocalNotifications.smallIcon`); `scripts/native.js`
  `scheduleLocalNotifications` (no `smallIcon`)
- `LocalNotificationManager.getDefaultSmallIcon` falls back to `android.R.drawable.ic_dialog_info`
  when no `smallIcon` is configured. Every reminder in the status bar is a blue "i".
- Fix: add a monochrome `res/drawable/ic_stat_gb.xml` and `"LocalNotifications": {"smallIcon":
  "ic_stat_gb", "iconColor": "#F97316"}`.

### P15. Steps auto-tick depends on a plugin that is not installed
- Severity Medium, effort S
- `scripts/native.js` `readTodaySteps`; `scripts/app.js` `autoTickStepHabits`
- `@capgo/capacitor-health` is not in the mobile package.json; the Proxy's `isAvailable()` rejects
  and the function returns null on every call, so Steps habits never auto-tick or prefill. The
  comment and `docs/scripts/native.js.md` describe a manifest that strips health permissions -
  there is none.
- Fix: install the plugin (Health Connect permission + `privacy.html` link, HealthKit entitlement
  on iOS) or drop the code path and the doc line.

---

## Low

### P16. `android:allowBackup="true"` backs up the session token
- Severity Low, effort S
- `android/app/src/main/AndroidManifest.xml`
- Cookies (`gb.token`, `gb.session`) and the Cache API store live in app data, which Auto Backup
  copies to the user's cloud and restores onto a new phone - a live bearer token restored outside
  the signed-in-devices list's knowledge.
- Fix: `android:allowBackup="false"` (or a `dataExtractionRules` excluding `app_webview`).

### P17. Tab hops pile up history, so back on Home walks through old tabs
- Severity Low, effort S
- `scripts/app.js` `setScreen` (`history.pushState` per screen); `scripts/gb-kit.js` back listener
- Home -> Money -> Notes -> Home, then back, goes to Notes, Money, Home before it can minimise.
  Android convention for bottom-nav apps is back -> Home -> exit.
- Fix: for nav-tab destinations use `replaceState`; keep `pushState` for drill-ins.

### P18. Mobile repo state: `@capacitor/app` and versionCode 7 are uncommitted
- Severity Low, effort S
- `Growth-Buddy-Mobile/package.json`, `android/app/build.gradle`, generated gradle files,
  `Package.swift` (all `M` in `git status`)
- The back-button handler needs `@capacitor/app`; a fresh clone or another session's checkout
  builds without it and the bridge listener goes to a plugin that does not exist.
- Fix: commit the mobile changes with the web build they belong to.

### P19. `USE_EXACT_ALARM` is a Play-policy restricted permission
- Severity Low, effort S
- `android/app/src/main/AndroidManifest.xml`
- Play only allows it for apps whose core function is alarms/calendar; a habit app may be asked
  to justify it or be rejected. Already flagged in the manifest comment.
- Fix: be ready to drop it for `SCHEDULE_EXACT_ALARM` + `changeExactNotificationSetting` (the
  plugin already exposes both).

### P20. iOS `UIRequiredDeviceCapabilities` still lists `armv7`
- Severity Low, effort S
- `ios/App/App/Info.plist`
- iOS 15 minimum is arm64-only; `armv7` is a stale template entry that App Store validation warns
  on.
- Fix: replace with `arm64`.

### P21. Device alarms go quiet after 14 days without opening the app
- Severity Low, effort M
- `scripts/push.js` `HORIZON_DAYS`, `syncDeviceAlarms`
- The web gets every reminder from the server; the app only rings what it queued at its last
  sync (water: 3 days). An app left closed for two weeks stops reminding with no signal. Marked
  ponytail.
- Fix: schedule one silent "open Growth Buddy to keep reminders on" notification at the horizon
  end, or move to FCM (P10).
