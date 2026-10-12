# Native changes for ../Growth-Buddy-Mobile

The web side of the parity audit (`GB-overhaul/docs/audit/parity.md`) is in `scripts/`. These are
the native halves, written as patches because the mobile repo has someone else's uncommitted work
(`build.gradle`, `package.json`, `Package.swift`). None of the patched files is in that work, so
both apply cleanly on top of it:

```sh
cd ../Growth-Buddy-Mobile
git apply --check --verbose ../Growth-Buddy/docs/mobile-native-changes.patch   # read-only
git apply ../Growth-Buddy/docs/mobile-native-changes.patch
git apply ../Growth-Buddy/docs/mobile-ios-associated-domains.patch            # see "iOS links" first
npm run sync    # copies capacitor.config.json into both platforms; the smallIcon is read from there
```

## `mobile-native-changes.patch`

| Hunk | Audit | Why |
|---|---|---|
| `MODIFY_AUDIO_SETTINGS` | P4 | For a page's `getUserMedia({audio})` Capacitor requests `RECORD_AUDIO` **and** this, and grants only if both are held. Undeclared, "Record a sound" failed with no prompt and told the user to allow something that isn't there. Normal permission: granted at install. |
| `CAMERA` + `uses-feature camera required=false` | P13 | The barcode scanner's `getUserMedia({video})` was denied without a prompt. Declared, the photo inputs (food, receipts, notes, family) now prompt once before the camera opens; Capacitor's file chooser already handles that. `required=false` keeps Play from hiding the app on camera-less devices. |
| https `intent-filter` with `autoVerify` | P8 | Links to `growth-buddy-cu63.onrender.com` (Circle invites, shared screens) open the app. `native.js onDeepLink` reads `getLaunchUrl` (cold start) and `appUrlOpen` (warm, the activity is `singleTask`), and the hash routes through the normal `hashchange`. |
| `allowBackup="false"`, `fullBackupContent="false"`, `res/xml/data_extraction_rules.xml` | P16 | Auto Backup and Android 12+ device transfer copied app data, including the WebView's `gb.token` / `gb.session` cookies, onto another phone: a live session the signed-in-devices list never saw. Everything the user owns is on the server, so all domains are excluded. `allowBackup` covers Android 11 and below; the rules file covers 12+, where `allowBackup` alone does not stop device transfer. |
| `res/drawable/ic_stat_gb.xml` + `LocalNotifications.smallIcon/iconColor` | P14 | Without a configured small icon the plugin falls back to `android.R.drawable.ic_dialog_info`, a blue "i". The new vector is the logomark's sprout, white on transparent (Android uses only the alpha), tinted `#F97316`. Set in `capacitor.config.json`, not per notification, so an older APK never asks for a drawable it lacks. |
| Info.plist `NSCameraUsageDescription` | P6 | iOS kills the app on first camera access without it: the food photo, receipt, notes and family photo inputs (`capture`) and the barcode scanner. |
| Info.plist `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` | P6 | Picking from the library goes through WKWebView's picker, which mostly needs no string, but older iOS paths and "Save Image" from the share sheet (story cards, `share-card.js`) do, and the add-only one is a crash without it. |
| `UIRequiredDeviceCapabilities` `armv7` -> `arm64` | P20 | iOS 15 is arm64-only; App Store validation warns on the stale template entry. |

Microphone and speech strings were already present.

## `mobile-ios-associated-domains.patch` (separate on purpose)

Adds `App/App.entitlements` with `applinks:growth-buddy-cu63.onrender.com` and points both build
configurations at it (`CODE_SIGN_ENTITLEMENTS`). It is its own patch because **Associated Domains
needs a paid Apple Developer Program team**: a free personal team cannot sign it, and the build
fails at signing. Apply it only when the app is signed with a paid team.

## Files the web host must serve (not in either patch)

Verification needs two files on `https://growth-buddy-cu63.onrender.com/.well-known/`. They need
values only the release owner has, so they are not committed here:

- `assetlinks.json` (Android): the release key's SHA-256 fingerprint, from
  `keytool -list -v -keystore $GB_KEYSTORE` (or Play Console > App integrity if Play signs).
  ```json
  [{"relation":["delegate_permission/common.handle_all_urls"],
    "target":{"namespace":"android_app","package_name":"com.growthbuddy.app",
              "sha256_cert_fingerprints":["<release SHA-256>"]}}]
  ```
- `apple-app-site-association` (iOS, no extension, `application/json`):
  `{"applinks":{"details":[{"appIDs":["<TEAMID>.com.growthbuddy.app"],"components":[{"/":"/*"}]}]}}`

Putting them in this repo's `public/.well-known/` ships them with the SPA the backend serves.
Until `assetlinks.json` is live, Android 12+ opens the links in the browser unless the user turns on
Settings > Apps > Growth Buddy > Open by default > "Open supported links".

## USE_EXACT_ALARM (P19): recommendation

Keep it for now and declare the app as a **calendar app with event reminders** in the Play
Console's exact-alarm declaration: Growth Buddy has a calendar and the user sets each reminder's
time, which is the case the policy allows. If review refuses it, remove the
`USE_EXACT_ALARM` line (the plugin already merges `SCHEDULE_EXACT_ALARM`) and add a Settings >
Alerts row that calls `LocalNotifications.checkExactNotificationSetting()` and, when it says
`denied`, `changeExactNotificationSetting()` to open the system page. Without one of the two,
targetSdk 36 makes every reminder inexact and Doze lands a 09:00 reminder 9-15 minutes late. No
patch hunk, because the current manifest is the recommended state.

## Not covered here

- **Android 15+ status-bar strip colour (P11).** `applyNativeStatusBar` no longer lets one
  refused call skip the rest, so the icon colour (`setStyle`) always lands. But on 15+ the strip
  behind the bar is the window background from `AppTheme.NoActionBar` (DayNight), which follows the
  phone, not the in-app theme. Matching it needs native code (window background colour set from JS
  through a small plugin call), not a config change.
- **Steps (P15).** `@capgo/capacitor-health` is still not installed. The web side now treats it
  as absent (no native call, no error, nothing ticks). Installing it is a `package.json` change in
  the repo with the uncommitted work, plus Health Connect's READ_STEPS permission and privacy
  activity and the iOS HealthKit entitlement.
- **iOS speech (P12).** The plugin has no SPM package, so the iOS build has no voice input; the
  mic is now hidden there instead of failing. Shipping it needs CocoaPods or an SPM-capable fork.

## Testing on a device

Build and install: `npm run sync && npx cap run android` (or open in Xcode for iOS).

1. **Microphone (Android).** Settings > Reminders > Record a sound. Expect the system mic prompt
   the first time, then a recording. Before: an immediate "Microphone access is blocked".
2. **Camera.** Food > Scan barcode: Android prompts for camera, the preview shows. Food photo /
   Money receipt on iOS: the camera opens instead of the app closing.
3. **Back button (web change, needs a device).** Open the bell on Home after a cold start, press
   Back: the panel closes and the app stays open; Back again minimises. On Habits open the profile
   menu, Back closes it and stays on Habits; Back again goes to the previous screen.
4. **Notification tap (web change).** Create a reminder 2 minutes out, lock the phone, tap the
   notification: the app opens on Calendar with that day selected. A habit reminder opens Habits,
   the water nudge Home, the focus timer's end alarm the timer.
5. **Small icon.** Any reminder in the status bar shows the orange sprout, not a blue "i". Needs
   `npm run sync` after applying, since the plugin reads the copied `capacitor.config.json`.
6. **Deep links.** With `assetlinks.json` served: `adb shell pm verify-app-links --re-verify
   com.growthbuddy.app`, then `adb shell pm get-app-links com.growthbuddy.app` should say
   `verified`. Without it, enable "Open supported links" by hand. Then
   `adb shell am start -a android.intent.action.VIEW -d "https://growth-buddy-cu63.onrender.com/#/circle?join=CODE"`
   opens the app on Circle and joins (test both with the app closed and running).
7. **Backup.** `adb shell bmgr backupnow com.growthbuddy.app` reports the package as not
   eligible / backs up nothing; a device-to-device transfer arrives signed out.
8. **Voice on iOS.** Quick add shows no mic button (the speech plugin is not in the SPM build).
   Android still shows it and it works.
