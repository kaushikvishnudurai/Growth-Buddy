# Handoff: make the user's own notification sound ring on the phone

Next session: **only this**. Build it, prove it on a real Android phone, nothing else.

## Status (2026-10-17)

- User report after installing APK versionCode 11 / web build 104: **custom sound does not ring on the
  phone.** Camera re-ask worked. Water thank-you card untested.
- Web (browser tab open) plays own sounds fine. A closed browser can't, and that's a platform rule: Web Push
  uses the OS sound. Out of scope.
- Phone has **no FCM**: every phone alert is a LocalNotifications alarm queued on the device
  (`syncDeviceAlarms` in `scripts/push.js`). So this is purely: does the alarm's channel play the file?
- Nothing below has been verified on a device. All fixes so far were from reading code + JS tests.

## Repos and state

- Web: `/Users/kaush-zstch1550/github/Growth-Buddy`, `main` @ `5c2be73` (build 104), pushed.
- Mobile: `/Users/kaush-zstch1550/github/Growth-Buddy-Mobile`, `master` @ `f1b702a` (versionCode 11).
  **No git remote**: commits are local only. `package-lock.json` has an unrelated uncommitted change.
  Repo-local git identity is set to kaushikvishnudurai@gmail.com.
- APK: `Growth-Buddy-Mobile/android/app/build/outputs/apk/debug/app-debug.apk`
  (`npm run sync` in the mobile repo, then `cd android && ./gradlew assembleDebug`).
- Bump `BUILD` in web `vite.config.js` and `versionCode` in `android/app/build.gradle` per release.

## How an own sound is supposed to reach the phone

1. User uploads or records a sound (Settings → Alerts). `chime.js` `readCustomChime` / `recordCustomChime`.
   Stored on the server (`/api/notifications/custom-sounds`) and on the device: index at
   `CUSTOM_CHIMES_KEY`, bytes per sound at `customChimeBytesKey(id)` in CacheStorage (`app.js`
   `storeCustomChimes` / `readCustomChimes` / `loadCustomChime`). Key = `custom:<first 8 of id>`.
2. `push.js` `alarmTone(key)` → `{sound, customSound: {name, url: dataUrl}, channelId}`;
   `channelForTone(key)` → `customChannel(own)` = versioned `gb-tone-custom-<id8>-r2`.
   `customChime(key)` returns null when the bytes are not on this device. **Then it silently uses the
   default channel.**
3. `native.js` `scheduleLocalNotifications` → `ensureChannel(LN, id, sound, custom)`: for a custom id it
   calls the native `CustomNotificationSound.ensureChannel({id, name, dataUrl})`. On any reject it
   caches `false` and **the alarm silently falls back to `gb-tone-default`**. That's a likely place for
   the failure to hide.
4. Native: `Growth-Buddy-Mobile/android/app/src/main/java/com/growthbuddy/customsound/CustomNotificationSoundPlugin.java`
   decodes the base64 data URL → `filesDir/gb_sounds/<id>.<ext>` → FileProvider URI
   (`${applicationId}.fileprovider`, `res/xml/file_paths.xml` has `files-path gb_sounds/`) →
   `grantUriPermission("com.android.systemui", uri, READ)` → `NotificationChannel(IMPORTANCE_HIGH)`
   with `setSound(uri, USAGE_NOTIFICATION)`. An existing channel is never rebuilt (Android locks a
   channel's sound); it only re-grants the URI.
5. The patched LocalNotifications plugin (`patches/@capacitor+local-notifications+8.3.1.patch`) posts with
   that `channelId`. Built-in tones (`res/raw/gb_<key>.wav`) do ring, so scheduling + channelId work.

## Suspects, most likely first. Confirm each with evidence before fixing.

1. **Wrong process granted.** Notification sounds are played by **system_server** (package `android`,
   NotificationManagerService / NotificationPlayer), not only System UI. The grant goes to
   `com.android.systemui` only. Check logcat for `SecurityException` / `Permission Denial` on the
   FileProvider URI when the alarm fires. Candidate fixes:
   - also grant to `"android"`;
   - or avoid content URIs entirely: copy the sound into **shared media**
     (`MediaStore.Audio`, `IS_NOTIFICATION=1`) and use that URI;
   - or ship it as `android.resource://` (impossible for user files; noted for completeness).
2. **Bytes not on the phone.** Sound made on the web, phone never pulled the bytes → `customChime(key)`
   null → default channel. Check what the phone's CacheStorage holds, and whether `loadCustomChime` /
   the custom-sounds fetch runs in the app.
3. **Plugin call rejected and swallowed** (`ensureChannel` catch in native.js): data URL shape
   (`data:audio/webm;codecs=opus;base64,` is stripped to `audio/webm` by `readCustomChime`, but check
   what the server returns), the 300 kB cap, or `PluginHeaders` missing `CustomNotificationSound`
   (then `nativePlugin` returns null and `ok=false`).
4. **Format.** Recordings are `audio/webm` (Opus). Notification playback goes through MediaPlayer, which
   supports WebM/Opus from Android 5, but verify on this phone. Test an uploaded **mp3/wav** separately.
   If webm fails, transcode on record (record as wav via AudioContext, as `gen-chimes` writes wav) or
   convert server-side.
5. **A stale channel from an older build** on this phone (an id created without a sound). `-r2` ids were
   added for this reason. Check the actual channel list on the device.
6. **The reminder isn't using the own sound at all**: per-reminder `sound` vs default `notifySound`;
   `alarmTone()` with no key uses `deviceTone` / `setToneSource`. Log the final `channelId` per alarm.

## Diagnose on the device first (adb)

```sh
adb install -r Growth-Buddy-Mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell dumpsys notification | grep -iA6 "gb-tone-custom"     # channel exists? its sound URI? importance?
adb shell run-as com.growthbuddy.app ls -l files/gb_sounds       # file written? size > 0?
adb logcat -c; adb logcat | grep -iE "NotificationService|NotificationPlayer|Ringtone|MediaPlayer|FileProvider|Permission Denial|SecurityException|gb_sounds|Capacitor"
```

Use `chrome://inspect` → the WebView console to log, in `native.js` `scheduleLocalNotifications`, each
alarm's final `channelId` and the result of `CS.ensureChannel` (temporarily, or behind a debug flag).
Remove the logging before shipping.

## Acceptance test (all on a real phone, record results)

For **each** of: an uploaded mp3, an uploaded wav, a recorded voice clip (webm):
1. Pick it as the default alert tone → Settings → Test notification: the own sound plays, and a
   `Reminders · <name>` channel appears in system notification settings.
2. A timed reminder 2 minutes out using it, app in foreground → own sound.
3. Same, app backgrounded → own sound.
4. Same, app swiped away (killed) → own sound.
5. Reboot the phone, don't open the app, let a queued reminder ring → record what plays. Then open the
   app once and let the next one ring → own sound. (Known gap: a BOOT_COMPLETED receiver may be needed.)
6. Pick the sound per reminder (not default) → that reminder only uses it.
7. Delete the own sound → its channel and file are pruned (`pruneCustomChannels`), and reminders fall
   back to the default tone, not silence.
8. Built-in tones and Silent still behave (Silent makes no sound).

Add a `push.test.mjs` case for any JS logic changed. Keep `node scripts/push.test.mjs`, all
`scripts/*.test.mjs`, `npm run lint` and `./mvnw -q test` green. Update `docs/scripts/chime.js.md`,
`docs/scripts/push.js.md`, `docs/scripts/native.js.md` lines that change.

## Constraints

- No emoji anywhere. Persist to DB, not localStorage. Commit as kaushikvishnudurai@gmail.com.
- Don't kill other sessions' listeners (`lsof -ti tcp:PORT -sTCP:LISTEN`).
- Ask before pushing the mobile repo anywhere (it has no remote) and before creating a GitHub repo.
