# Responsive and app-parity audit (RSP)

Build 92, branch overhaul/2026-10-11, Vite dev on :5591 against backend :8591, one seeded account
(e2e.1791739969676.7520@example.com). Playwright attached over CDP (http://localhost:9591).

## What was run

- **Viewport walk**: 15 screens (home, report, achievements, health, focus, habits, food, summary,
  calendar, mentor, circle, family, money, notes, goals) at 320x640, 360x780, 390x844, 768x1024,
  844x390 (landscape), touch emulation on; and 1024x768, 1440x900, 2560x1440, 3840x2160 without.
  Per screen: document and `#gb-main` horizontal overflow, every visible element past the viewport
  edge that no clipping/scrolling ancestor contains, leaf text clipped by its box, and on touch
  widths every control whose real hit area is under 44px. The hit area was probed with
  `elementFromPoint` out from the centre, so a `::before`/`::after` hit-slop counts. Also console
  errors and HTTP 4xx/5xx. Screenshots: `docs/evidence/audit-responsive/<screen>-<w>x<h>.jpg` (135).
- **Keyboard**: a fake `visualViewport`, shrunk by 330px (installed before boot, so `openOverlay`
  captures it), on 9 dialogs. Checked whether the focused field and the primary button stay inside
  the visible area. Evidence: `kb-*.jpg`.
- **Back**: `history.back()` (this is what the Android `backButton` listener calls when
  `canGoBack`) with each surface open. Code read: gb-kit.js `syncSheetHistory`, the `backButton`
  listener, `trackOverlay`; app.js `setScreen`, `toggleMoreOpen/NotifOpen/ProfileOpen`.
- **Offline**: `context.setOffline(true)` after an online boot (writes, screen loads, reconnect),
  and a cold boot with every `/api` and `/ws` request aborted. That second case is the Capacitor
  app opened with no signal: the bundle is local and app.js unregisters any service worker when
  `isNative()`. Evidence: `offline-*.jpg`.
- **Permissions and native parity**: read push.js, native.js, the speech/camera/mic code, the
  share/export code, `../Growth-Buddy-Mobile` package.json, the merged manifests, and the Capacitor 8
  `BridgeWebChromeClient` / `SystemBars` sources (read-only; nothing was built or synced).

## Clean results (no finding)

- **Zero horizontal overflow** in all 135 screen/viewport combinations. The document never scrolls
  sideways, `#gb-main` never does, and no element sits past the edge outside a scroll rail.
- **Zero clipped text** detected, and zero console errors or failed requests during the walk.
- **Keyboard in dialogs works.** New task, New habit, Sleep, Mood, Add expense, Note editor and New
  goal (first and last field each): the overlay pins to the visible height (514 of 844), the
  focused field and the primary button both stay visible, and nothing needs scrolling. Capacitor 8
  `SystemBars` pads the WebView parent by the IME inset, so in the app the layout viewport itself
  shrinks, as the gb-kit.js comment says.
- **Back closes dialogs.** With Quick add open, back closed the sheet and stayed on the screen.
  Family panels and the celebration overlay use `trackOverlay`.
- **Notification denied paths** (push.js `enablePush`, app.js `enablePushFlow`) say what to do on
  web and native. The speech-to-text denied paths say so too, on both the web
  `SpeechRecognition` path and the native plugin path.
- **Safe areas**: the header, bottom nav, toasts, the modal overlay, the More sheet and the
  landscape rail all use `env(safe-area-inset-*)`, and `viewport-fit=cover` is set. The one gap is
  RSP-8.

---

### RSP-1: In the app, every export and share card silently does nothing while saying it worked
- Severity: High
- Where: share-card.js `shareStoryCard` / `shareNatively`; app.js `downloadMyData` and the
  reminders .ics export (the `growth-buddy-reminders.ics` block); money.js `downloadLedgerCsv`.
  Capacitor app only.
- Repro / evidence: read end to end. `shareNatively` calls `nativePlugin('Filesystem')` and
  `nativePlugin('Share')`. Neither plugin is installed in `../Growth-Buddy-Mobile`: package.json
  has no `@capacitor/filesystem` or `@capacitor/share`, and `node_modules/@capacitor/` holds only
  android, app, browser, cli, core, device, ios, local-notifications, splash-screen and
  status-bar. The proxy call rejects, so the function returns null and falls through. Android
  WebView has no Web Share API, so `navigator.canShare` is absent, and the code reaches the
  `<a download href=blob:...>` fallback. Capacitor's Android bridge registers no
  `DownloadListener`: grepping `DownloadListener|onDownloadStart|blob:` in
  `node_modules/@capacitor/android/capacitor/src/main/java` and in `MainActivity.java` finds
  nothing. A blob download in the WebView is therefore dropped. Then the success toast still
  fires: "Image saved — add it to your story." (Money weekly card), "Image saved. Add it to your
  story." (Report month card), "Your data is downloading.", "Your calendar file is downloading...",
  "Your money CSV is downloading."
- Cause: the native share ladder depends on two plugins that were never added to the wrapper, and
  the last rung (a blob download) cannot work in a WebView without a download handler.
- Fix: add `@capacitor/filesystem` and `@capacitor/share` to `../Growth-Buddy-Mobile` and
  `npm run sync`. That makes `shareNatively` work for the cards. Route `downloadMyData`, the .ics
  export and `downloadLedgerCsv` through the same `shareNatively` (export it from share-card.js
  and pass a Blob of any type). Until then, on `isNative()` show an error toast instead of
  "downloading".

### RSP-2: Opening the app with no connection shows the crash card on every screen
- Severity: High
- Where: app.js `loadData` (the wave-1 `catch` sets `state.error`), the boot block's service worker
  unregister under `isNative()`. Capacitor app, cold start offline.
- Repro / evidence: boot online and visit Money so its document is cached. Then abort `**/api/**`
  and `**/ws/**` and reload. Home, Money, Notes and Calendar all show only "That didn't go
  through. We couldn't reach your data just now..." with Try again
  (`offline-coldboot-home-390.jpg`, `offline-coldboot-money-390.jpg`,
  `offline-coldboot-notes-390.jpg`, `offline-coldboot-calendar-390.jpg`). On the web build the
  Workbox `NetworkFirst` cache (`gb-api-get`, vite.config.js) answers those GETs offline, which is
  what the banner text "showing your last saved data" assumes. app.js deliberately unregisters
  that worker inside the app, so nothing answers there. The cached money document, wellness,
  trends and quote are already in CacheStorage, but the crash card hides them.
- Cause: the offline-first design rests on the service worker. The app removes the service worker
  and has no replacement, and a failed first load is treated as fatal.
- Fix: in `loadData`, when the first load fails with `networkError` and CacheStorage holds a
  snapshot for this user, paint from it and show the offline banner instead of `CrashCard`. Cache
  the five wave-1 responses next to the money document (one `CacheStorage.setItem` per response
  where loadData assigns `state.tasks` / `habits` / `reminders` / `water` / score). Files:
  scripts/app.js.

### RSP-3: A mood or sleep check-in saved offline looks saved, then vanishes on the next load
- Severity: High
- Where: app.js `saveMoodEntry`, `saveSleepEntry`, and the `dailyLogs` merge in
  `loadSecondaryData`. Web and app.
- Repro / evidence: go offline, then Quick add, Mood, pick Low, type a note, Save check-in. The
  sheet closes. The Home card shows the new value ("Mood low") and a toast says "You're offline,
  so that didn't go through. Try again once you reconnect." Reconnect and reload: the card is back
  to "Mood good", and `GET /api/daily-logs?days=2` still holds `mood: good`
  (`offline-mood-saved-390.jpg`, `offline-mood-after-reload-390.jpg`). The typed note is gone and
  the sheet holding it closed. The only way to "try again" is to remember it and type it again.
- Cause: both functions paint and cache locally (`persistWellness`), then POST once with no queue.
  `loadSecondaryData` then replaces `sleepByDate`/`moodByDate` wholesale with the server's copy.
  `handleOnline` triggers `loadData`, so reconnecting is exactly what erases it.
- Fix: send both through the existing outbox (`queueWrite({ method: 'POST', path:
  '/api/daily-logs/mood', ..., kind: 'mood.create' })` on `networkError`), as `createTask` does,
  and lay queued entries over `dailyLogs` in the merge (as `overlayOutbox` does for tasks). Or, at
  minimum, keep the dialog open on a network error. Files: scripts/app.js.

### RSP-4: The More sheet, the bell panel and the account panel are not in the back stack
- Severity: Medium
- Where: app.js `toggleMoreOpen`, `toggleNotifOpen`, `toggleProfileOpen`; gb-kit.js
  `trackOverlay`. Android back button and browser back, phone widths.
- Repro / evidence: Home, then the Progress tab, then open More, then back. The result is
  `#/home` with the sheet gone, so back left Progress instead of closing the sheet. The same
  happens for Notifications and Account (each landed on `#/home`). With Quick add open, back
  correctly stayed on `#/report` and only closed the sheet (scratchpad `rsp-back.mjs` output). At
  the root (Home, nothing to go back to) the `backButton` listener calls `App.minimizeApp`, so on
  a phone back with More open minimises the app.
- Cause: these three are `state.*Open` flags repainted by `repaintOverlays`. They never call
  `trackOverlay`, the hook gb-kit.js gives non-`openOverlay` surfaces such as Family's panels.
- Fix: in each toggle, when the flag turns on, call `trackOverlay({ close: closePopovers })` and
  keep the untrack. Call it from `closePopovers` / `setScreen` when the flag turns off. One shared
  helper beside `installOutsideClickToCloseHeaderPopovers` covers all three. File: scripts/app.js.

### RSP-5: In the app, the barcode scanner and custom-tone recording are refused without a prompt
- Severity: Medium
- Where: app.js `openBarcodeScanner` (`getUserMedia({video})`); chime.js `recordCustomChime`
  (`getUserMedia({audio})`, used by the tone pickers at app.js `recordCustomChime` call sites).
  Capacitor Android.
- Repro / evidence: read end to end. Capacitor's `BridgeWebChromeClient.onPermissionRequest` turns
  a WebView `VIDEO_CAPTURE` request into a runtime request for `CAMERA`, and `AUDIO_CAPTURE` into
  `MODIFY_AUDIO_SETTINGS` + `RECORD_AUDIO`. It grants only when every entry comes back granted. The
  merged manifest declares `RECORD_AUDIO` (from the speech-recognition plugin) but neither
  `CAMERA` nor `MODIFY_AUDIO_SETTINGS`: grepped the app manifest and every plugin manifest. Android
  reports an undeclared permission as denied without showing a dialog. So the scanner shows "Camera
  permission was refused. Type the food in instead." and the recorder "Microphone access is
  blocked. Allow it for Growth Buddy and try again." The user never refused anything and has no
  setting to change. Both buttons are shown because `canScanBarcode` / `canRecordChime` only test
  the web APIs.
- Cause: missing manifest permissions in the wrapper.
- Fix: add `<uses-permission android:name="android.permission.CAMERA" />` and
  `android.permission.MODIFY_AUDIO_SETTINGS` to `../Growth-Buddy-Mobile/android/app/src/main/AndroidManifest.xml`
  (not done here: Android files were out of scope), or hide both buttons when `isNative()`. Note:
  declaring CAMERA makes Capacitor's file chooser ask for CAMERA before `capture=environment`
  photo inputs (`isMediaCaptureSupported`), which is fine.

### RSP-6: Writes queued while "online" (server unreachable) wait until the next app launch
- Severity: Medium
- Where: app.js `flushOutbox`, `queueWrite`, `handleOnline`; the `networkError` test.
- Repro / evidence: read end to end, with one run reproducing it. `createTask` (and the other
  outbox writers) queue on `networkError`, which includes "no response" while `navigator.onLine`
  is true: Wi-Fi without internet, a captive portal, Render waking up behind a dropped connection.
  After that, `flushOutbox` runs only after loadData's wave 1 and on the `online` event, and the
  `queueWrite` call tries once immediately. There is no timer and no `visibilitychange` flush.
  When `navigator.onLine` never went false, no `online` event follows, so the "Saved on this
  phone — will sync" items sit in `gb.outbox.<uid>` until the next full load. Two of four
  emulated reconnects here also delivered no `online` event. In those runs the queued
  `POST /api/tasks` stayed in the outbox for 30 s with zero API requests
  (`outbox after [...Sync check...]`, `REQS []`). When the event did fire, it synced in 2.5 s.
- Cause: flushing hinges on one browser event.
- Fix: also call `flushOutbox()` from the existing `visibilitychange` handler, and on a backoff
  timer while `outbox.size()` is non-zero (for example 30 s, doubling to 5 min; the money re-push
  interval already sets that pattern). File: scripts/app.js.

### RSP-7: Adding a task offline shows "Task added." next to "Saved on this phone" and "No connection"
- Severity: Low
- Where: app.js the task sheet's `onPrimary` (`await createTask(...); toastSuccess('Task added.')`),
  also Buddy's `act.task`; `queueWrite`.
- Repro / evidence: offline, Quick add, Task, "Sync check", Add task. The toasts read "No
  connection. Check your internet and try again.", "Task added.", "Saved on this phone — will
  sync when you're back online." (`offline-toast-over-sheet-390.jpg`). On a phone, with a dialog
  open, the stack moves to the top of the screen and covers the sheet's title and first option.
  Playwright's click on the Habit option was refused with "gb-toast-msg ... intercepts pointer
  events".
- Cause: `createTask` returns normally on the queued path, so the caller's success toast also
  runs, and the queue posts its own info toast. Separately, a background refresh posts the
  connection error.
- Fix: have `createTask` return `'queued'` and skip `toastSuccess` in that case. Drop connection
  toasts while `state.online === false` (the banner already says it), as `handleOnline` does with
  `isConnectionToast`. Files: scripts/app.js.

### RSP-8: Landscape never pads for a right-hand display cutout
- Severity: Low
- Where: styles/app.css, the `@media (orientation: landscape) and (max-height: 500px)` block and
  `.gb-head` / `#gb-main` padding.
- Repro / evidence: `grep safe-area-inset-right styles/*.css` finds no match. The rail pads
  `env(safe-area-inset-left)`, but a phone rotated the other way has its cutout on the right, where
  the header's avatar/bell and the cards' right edges sit at a plain 20px. Capacitor 8 `SystemBars`
  injects the real cutout insets into `env()` (WebView 140+, `viewport-fit=cover` is set), so the
  value is available. It is just not used.
- Fix: in that media block, `padding-right: max(20px, env(safe-area-inset-right, 0px))` on
  `.gb-head` and the `#gb-main` content column. Shown only on a device, so verify on one.

### RSP-9: Tap targets under 44px on phone widths
- Severity: Low (Medium for the first two)
- Where / evidence (measured real hit area at 320/360/390, from `rsp-walk.json`):
  - Calendar reminder tick `button.gb-rem-check`: 32x32 at every phone width (the primary action
    of a reminder row).
  - Month grids: Calendar `button.gb-cal-day` 35x35 (hit 39x40) at 320. Home mini calendar
    `gb-mini-cal-day` 34x34 at 320 and 39x39 at 360. At 320 the today cell's day-line mark (top
    299) also overlaps the numeral (bottom 300) (`calendar-today-cell-320.png`).
  - Food week columns `button.gb-food-week-col`: 29-40 px wide at 320-390.
  - Goals: the milestone input `gb-goal-ms-input` is 21px tall. The row icon buttons have a 40x44
    hit area and the ghost buttons 34x44.
  - Under 44 in one dimension: `gb-money-mini-head` (26 tall), `gb-home-goal` row (35),
    `gb-health-fact` (37), Calendar `gb-tagchip` (41), `gb-seg` (39), `gb-note-view` tabs (40),
    `gb-rem-defaults-link` (40), Focus `gb-login-link` (18), `gb-week-nudge` (42).
- Fix: the `::before { inset: -6px }` hit-slop the task row icons already use (they measured 44
  through it). Apply it to `.gb-rem-check`, `.gb-goal-ms-input`'s row, the segmented/tag chips
  and the small text-link buttons. Give the grid days `min-height: 40px` at <=360. Files:
  styles/app.css, styles/mini-calendar.css.

### RSP-10: Very wide screens: header left-aligned, content centred far away
- Severity: Low
- Where: 2560x1440 and 3840x2160, Home and Calendar (`home-3840x2160.jpg`,
  `calendar-3840x2160.jpg`).
- Repro / evidence: at 3840 the page title sits at x~290 next to the sidebar while the dashboard
  (capped at 1600px, `.gb-dash.gb-dash--single`) and the calendar column are centred about
  1000px to the right. The week-review banner runs the full width. The title and its content read
  as two unrelated pieces, and over 55% of the canvas is empty.
- Fix: cap and centre `.gb-head`'s inner row with the same max-width as the screen's content at
  >=1920px, or left-align content to the header inset as the Habits/Food/Circle rule already does.
  File: styles/app.css.

### RSP-11: Quick add's one-line field hides "Log it" behind the keyboard
- Severity: Low
- Where: Quick add sheet (gb-kit.js `openOverlay` focusin handler), 390x844 with a 330px keyboard.
- Repro / evidence: focus "e.g. spent 200 on lunch..." with the keyboard up. The field is
  visible, but the Log it button and the mic and language row under it are scrolled out of the
  sheet (`primaryVisible: false`, `kb-log_it-390.jpg`). The keyboard's Go key still submits.
- Fix: in that sheet, scroll the field's row container into view (`block: 'end'`) instead of the
  input alone, or move the one-line field above the option list. File: scripts/app.js (Quick add)
  or gb-kit.js.

---

Counts: Critical 0, High 3, Medium 3, Low 5.
