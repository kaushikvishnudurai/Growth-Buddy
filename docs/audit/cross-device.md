# Cross-browser and device audit (XD)

Tester: cross-device. Stack: integrated build on http://localhost:5588 (Vite from GB-ov1011-int), backend
:8590 (DB gb_ov1011), browser servers from `e2e/servers.sh` (Firefox 157, WebKit 27.2, Chromium 156, the
set already running from GB-ov1011-xbrowser). All runs: `GB_E2E_ALL=1 GB_E2E_CHROME=server`, six projects.

## How it was run

The integration branch kept moving while this ran (about 30 merges between 01:50 and 03:10), so a single
full pass was not one build. Three passes:

1. Full suite, `--workers=2` (HEAD 745fdc8 at start, d5034a4 at end). Ran project by project, so desktop
   Chrome ran on an older build than WebKit. Used only to find candidates.
2. One spec file at a time across all six projects, `--workers=2` (HEAD a34b1bb, 21c3fb9, d4d0680; each
   file's start and end HEAD logged). This is the main result below: every project ran the same file on
   the same build.
3. Control: the 33 tests that failed off desktop Chrome in pass 2, re-run with `TZ=UTC` and
   `timezoneId: 'UTC'` on every project (HEAD 8258175, unchanged during the run). This takes XD-1 out of
   the picture.

Before pass 2, `npm install` was run in GB-ov1011-int: merge f5e1d9f added `@fontsource-variable/hanken-grotesk`
but the worktree's node_modules did not have it (see XD-9).

### Pass 2: per project (167 tests each, 1 skipped)

| Project | Pass | Fail | Of the failures, engine/viewport-specific |
|---|---|---|---|
| desktop-chrome (1280x800) | 164 | 2 | (baseline) |
| mobile-chrome (Pixel 7) | 161 | 5 | 3 |
| tablet-chrome (iPad gen 7) | 162 | 4 | 2 |
| desktop-firefox (1280x800) | 159 | 7 | 7 |
| desktop-webkit (1280x800) | 143 | 23 | 21 |
| mobile-webkit (iPhone 14) | 139 | 27 | 25 |

### Pass 3: the 28 targeted tests per project, in UTC

| Project | Pass | Fail |
|---|---|---|
| desktop-chrome | 27 | 1 (OFF-6, integration) |
| mobile-chrome | 27 | 1 (OFF-6) |
| tablet-chrome | 27 | 1 (OFF-6) |
| desktop-firefox | 24 | 4 |
| desktop-webkit | 22 | 6 |
| mobile-webkit | 20 | 8 |

With the timezone offer out of the way, 22 of the WebKit failures pass, and so do the mobile/tablet
Chrome ones (those were intermittent). What is left is explained by XD-3/XD-4 and the harness items
XD-5 to XD-9.

### Failures that also fail on desktop-chrome (integration, not investigated)

- `planning-fixes.spec.mjs:154` EXP-4: after "Only past days", the new first day offers no past-days delete (all six projects, pass 2).
- `shell.spec.mjs:253` OFF-6: a screen never loaded, opened offline (all three Chrome projects and both WebKit; console errors and failed `PUT /api/auth/ui-prefs` while offline).
- Pass 1 only, fixed by later merges (pass on desktop Chrome in pass 2): bill subscription (409 on `PUT /api/money`), Notes archive/trash, circle create/join, family chores, typed quick add, palette free text, FRC-5 note composer, offline cold start (native-parity:75).

### Visual comparison (Home, Money, Calendar, Notes, the New task dialog)

Chromium, Firefox and WebKit at iPhone 14 (390x664) and iPad gen 7 (810x1080), seeded account,
screenshots `docs/evidence/cross-device/<engine>-<phone|tablet>-<screen>.jpg` (taken at HEAD 745fdc8).
No horizontal overflow on any screen in any engine (document and `#gb-main` scrollWidth equal the
viewport). Layout, type and spacing match across engines. Differences seen, none a bug:

- Home on Firefox has no microphone and language picker: Firefox has no `SpeechRecognition`, and the app
  hides them (feature detection working).
- The New task dialog's empty Due field: Chrome/Firefox show `dd/mm/yyyy, --:-- --`, desktop WebKit shows
  a greyed-out current date and time as its native placeholder. Native control, value is empty.
- Firefox formats times as "5:00 pm" (macOS regional preference), Chrome and WebKit "5:00 PM".
- WebKit at both sizes opened the "Switch to Kolkata time?" sheet over Home: that is XD-1.
- At tablet size the shell is a floating frame whose height follows the content in every engine: XD-2.

## Findings

### XD-1: Safari and the iOS app ask to "Switch to Kolkata time?" when the account is already on India time
- Severity: Medium
- Where: scripts/app.js:sameZone (used by offerDeviceTimezone); WebKit (Safari, iOS WKWebView in the Capacitor app), every viewport
- Repro / evidence: make an account in Chrome, Android or Node (all store `Asia/Calcutta`; seed.mjs does
  the same), open it in Safari or WebKit with the device in India. 1.5 s after boot the sheet reads "This
  device is on Kolkata (India Standard Time), your account on Calcutta (India Standard Time)".
  Screenshot `docs/evidence/cross-device/XD-1-webkit-tz-offer.jpg`. Per engine,
  `new Intl.DateTimeFormat('en', { timeZone: 'Asia/Calcutta' }).resolvedOptions().timeZone`:
  Chromium 156 `Asia/Calcutta`, Firefox 157 `Asia/Kolkata`, WebKit 27.2 `Asia/Calcutta` (it returns the
  name it was given, it does not canonicalise), while WebKit's device zone is `Asia/Kolkata`. Same for
  `Europe/Kiev` vs `Europe/Kyiv` and `America/Buenos_Aires` vs `America/Argentina/Buenos_Aires`.
  This sheet is also what fails most of the WebKit suite: it sits over the page and intercepts every
  click ("`<div class="gb-modal-overlay is-open">` intercepts pointer events", then "This device is on
  Kolkata" in 29 of the WebKit traces in pass 1/2). With UTC on both sides (pass 3) those tests pass.
- Cause: sameZone canonicalises the stored name through the current browser's Intl and compares the
  result with the device name as a string. That works only in engines that map aliases to one spelling.
  WebKit keeps the alias, so two spellings of the same zone compare unequal. `tzAsked` stops a second
  ask on that device, but every Safari/iPhone user with an account made elsewhere gets one confusing
  prompt, and "Switch" then rewrites the account for nothing.
- Fix: in scripts/app.js:sameZone, treat two zones as the same when their offsets agree now and six months
  from now, e.g. compare `new Intl.DateTimeFormat('en', { timeZone: z, timeZoneName: 'longOffset' }).format(d)`
  for both names at `d = now` and `d = now + 182 days` (covers DST), after the existing string check.
  Add a case for `Asia/Calcutta` vs `Asia/Kolkata`. Until then the WebKit projects need
  `timezoneId` set to the seeder's zone or the seeder should store a WebKit-equal name.

### XD-2: On a tablet the app frame shrinks to its content, so the bottom nav jumps between tabs
- Severity: Medium
- Where: styles/app.css, `@media (min-width: 480px) and (max-width: 1023.98px) and (min-height: 560px)`, `.gb-app { height: auto }`; iPad portrait (810x1080) and any 480-1023 px wide window, all engines
- Repro / evidence: iPad gen 7, seeded account. `.gb-app` top/height and the nav's top, per screen:
  Home, Goals, Focus, Calendar, Money, Report 90/900, nav at 907; Notes 290/499, nav at 707; Habits
  202/677, nav at 795. Switching tabs moves the nav bar up and down by up to 200 px and Notes is a
  short card floating in the middle of the screen. Screenshots
  `docs/evidence/cross-device/XD-2-ipad-notes-webkit.jpg`, `XD-2-ipad-focus-webkit.jpg`,
  `chromium-tablet-notes.jpg`. Same in Chromium, Firefox and WebKit.
- Cause: the tablet block sets `height: auto` with only a `max-height`, so the frame is as tall as the
  screen's content up to 900 px. On a phone and on desktop `.gb-app` has a fixed height (100dvh) and
  `#gb-main` scrolls inside it.
- Fix: in that media block replace `height: auto` with
  `height: min(900px, calc(100dvh - 2 * clamp(20px, 4vh, 40px)))` (the value max-height already uses),
  so the frame is the same size on every tab and the content scrolls in `#gb-main`.

### XD-3: In an ephemeral WebKit session nothing written to the Cache API survives a reload (offline sign-out stays live)
- Severity: Low
- Where: scripts/cache-storage.js (all persistence), scripts/app.js:queueRevoke/flushRevokes, the outbox; WebKit ephemeral data store (Playwright's default WebKit context, the store Safari Private Browsing uses)
- Repro / evidence: in a WebKit context, `caches.open('x').then(c => c.put('https://x/k', new Response('v')))`,
  reload: 0 entries (cache name kept, entries gone; also gone in a new tab). Chromium and Firefox keep 1.
  A persistent WebKit profile (`launchPersistentContext`) keeps it, so normal Safari is fine. In the app:
  sign out with `/api/auth/logout` failing, `gb.revoke.pending` is in the store, reload, the store is
  empty, no logout request is sent, and `/api/auth/me` with the old token still answers 200 (OFF-7 on
  both WebKit projects in all passes). OFF-1 (in-flight task re-sent after reload) and native-parity:75
  (offline cold start shows saved data) fail on WebKit for the same reason.
- Cause: WebKit's ephemeral store does not keep Cache API entries across documents. The session survives
  because the token and session are also cookies; the revoke queue and the outbox are Cache-API-only.
  Not reproduced on a real Safari Private window (no Safari here).
- Fix: for the one security-relevant item, retry the queued revoke before the page goes away:
  in scripts/app.js on `pagehide`, if `gb.revoke.pending` holds tokens, send each with
  `fetch(API_BASE + '/api/auth/logout', { method: 'POST', keepalive: true, headers: { Authorization: ... } })`.
  For the suite, skip OFF-1, OFF-7 and native-parity:75 on `engine === 'webkit'` (the harness cannot give
  WebKit a persistent context from the runner), with a comment pointing here.

### XD-4: A ui-prefs save in flight during a reload is cancelled and logged as an error (Firefox)
- Severity: Low
- Where: scripts/app.js:saveUiPrefs; desktop-firefox
- Repro / evidence: safety-shell.spec.mjs:50 (sign in through the form, reload) on desktop-firefox, pass 3:
  `console: saveUiPrefs failed to reach database: Error`. Firefox rejects the pending `PUT /api/auth/ui-prefs`
  when the page unloads and the catch runs before the document goes; Chromium tears the page down first,
  so nothing is logged there. Whether the server received the write is not determined by the client.
- Cause: the PUT is an ordinary fetch, so navigation cancels it, and the catch treats a navigation abort
  as a failure.
- Fix: send the PUT with `keepalive: true` (the body is a small JSON object, well under the 64 KB keepalive
  limit) in scripts/app.js:saveUiPrefs, so it completes across a reload in every engine, and skip the
  console.error when `document.visibilityState === 'hidden'` or the error is an AbortError.

### XD-5: The guard does not know Firefox's and WebKit's words for an aborted request (test harness)
- Severity: Medium (it fails three tests on two engines whose app behaviour passed)
- Where: e2e/fixtures.mjs, the `guard` fixture's `requestfailed` filter
- Repro / evidence: `route.abort('aborted')` reports `net::ERR_ABORTED` in Chromium, `NS_ERROR_ABORT` in
  Firefox and `Blocked by Web Inspector` in WebKit. The filter accepts
  `/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i`, so CNT-3 (planning-fixes:127), OFF-10 (planning-fixes:279)
  and native-parity:75 fail at teardown on Firefox and WebKit, with lines like
  `failed GET http://localhost:5588/api/goals NS_ERROR_ABORT`. Their assertions passed.
- Fix: in e2e/fixtures.mjs use `/ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_ABORT|Blocked by Web Inspector|cancelled/i`.
  WebKit also reports every fetch still open at a reload as a page error
  (`pageerror: /localhost:5588/api/tasks due to access control checks.`) and the socket as
  `WebSocket connection to 'ws://localhost:5588/ws' failed: The network connection was lost.`; both were
  intermittent here (HOS-6, Notes create on mobile-webkit) and could be ignored the same way during a reload.

### XD-6: NEW-8 and NEW-15 cannot run on an iPhone: there is no Notification object (test harness)
- Severity: Low
- Where: e2e/first-run-paths.spec.mjs:denyNotifications; mobile-webkit
- Repro / evidence: mobile-webkit has `typeof Notification === 'undefined'` and no PushManager (as iOS
  Safari outside an installed web app). The init script's `Object.defineProperty(Notification, ...)` throws
  `pageerror: Can't find variable: Notification` (NEW-15), and NEW-8 waits for "Notifications are blocked",
  which the app correctly never shows there (`pushSupported()` is false, so `remindersAsk()` returns null).
- Fix: guard the init script with `if (!('Notification' in window)) return;` and
  `test.skip(info.project.name === 'mobile-webkit', 'no web push on iOS Safari')` for NEW-8 and NEW-15.

### XD-7: PRF-2 waits on document.fonts.ready while the document is still loading (test harness)
- Severity: Low
- Where: e2e/perf.spec.mjs, "PRF-2: a first visit paints the sign-up card ..." (`look()`); desktop-firefox, desktop-webkit, mobile-webkit
- Repro / evidence: times out at `page.evaluate` on `await document.fonts.ready` in every pass, on Firefox
  and WebKit only.
- Cause: the test holds the entry module request (`holdEntry`), so the document has not finished loading.
  Gecko and WebKit keep `document.fonts` pending until the document has loaded (CSS Font Loading's
  "pending on the environment"); Chromium resolves it as soon as no face is loading.
- Fix: in that test wait for the face itself, `await document.fonts.load('400 1em "Hanken Grotesk"')`,
  instead of `document.fonts.ready`.

### XD-8: The seeder stores Node's spelling of the zone, which WebKit treats as a different zone (test harness)
- Severity: Low
- Where: e2e/seed.mjs (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `Asia/Calcutta` on this machine)
- Repro / evidence: see XD-1; with `TZ=UTC` and `timezoneId: 'UTC'` the 22 WebKit tests it broke pass.
- Fix: goes away with XD-1. Until then, set `timezoneId` explicitly on the WebKit projects in
  playwright.config.mjs and seed the same zone.

### XD-9: Firefox is the only engine that reports a missing web font, so a missing package failed only Firefox (environment)
- Severity: Low
- Where: GB-ov1011-int node_modules after merge f5e1d9f (one variable Hanken Grotesk face)
- Repro / evidence: pass 1 and the serial re-run, desktop-firefox: 16 failures, every one including smoke
  (`signs in and reaches Home`) with `downloadable font: rejected by sanitizer ... hanken-grotesk-latin-wght-normal.woff2`.
  `curl` of that URL returned 200 `text/html` (Vite's SPA fallback): the package was not installed.
  Chromium and WebKit drew the fallback font silently and passed. After `npm install` the Firefox smoke
  test passes.
- Fix: run `npm install` after merging a dependency change into a worktree that serves the build. Worth
  knowing that only the Firefox projects will notice a font that fails to load.

### XD-10: Older iOS versions the app still targets drop every color-mix() declaration
- Severity: Low
- Where: ../Growth-Buddy-Mobile/ios/App/App.xcodeproj (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`); styles/app.css (98 color-mix), styles/premium.css (16), money.css, mini-calendar.css, tokens.css
- Repro / evidence: not reproduced (no iOS 15 engine here; WebKit 27.2 supports everything). From the
  code: color-mix() needs Safari/WKWebView 16.2, and two `backdrop-filter` rules (`.gb-note-cover-count`,
  `.gb-note-card.has-cover .gb-note-pin`, styles/app.css) have no `-webkit-` copy, which iOS before 18
  needs. There are no `@supports` fallbacks for color-mix. On iOS 15.0-16.1 those declarations are
  invalid and dropped (e.g. the dark-mode page gradient, focus rings and danger tints built with it).
- Fix: raise the deployment target to 16.4 (what the CSS already assumes: color-mix, :has, dvh) in the
  mobile project, and add `-webkit-backdrop-filter` beside the two unprefixed rules.

## Notes

- Running every spec writes screenshots into other teams' `docs/evidence/*` folders (the specs' own
  `SHOTS` paths); those files are modified in the worktree as a side effect of this audit.
- Pass 2 intermittents that passed on re-run in pass 3: Notes archive/trash ("Delete note" matched two
  buttons, mobile-chrome, tablet-chrome, firefox), water total (mobile-chrome), OFF-9 screenshot timeout
  (tablet-chrome), the 3-day break test (mobile-chrome, firefox, webkit; 150 s scheduler poll).

Counts: Critical 0, High 0, Medium 3 (XD-1, XD-2, XD-5), Low 7.
