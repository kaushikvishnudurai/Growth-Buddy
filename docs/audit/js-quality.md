# JS quality audit: scripts/*.js (build 88)

Static read of `feat/overhaul`. `npm run lint` is clean and every `scripts/*.test.mjs` passes, so
none of this is something the existing checks catch. QA-01..QA-11 in `bugs.txt` are not repeated here.
Symbols are named, not line numbers: `grep -n` them.

What came out clean: the XSS surface. `h()` only ever writes text nodes and attributes. The only
`innerHTML` writes are constant SVG (`CrashCard`, `GARDEN_SVG`) and note bodies that go through
`notes.js` `sanitize()` (an allow-list, with `SAFE_HREF` / `SAFE_IMG`) on the way in and on the way
out. No `eval`, `new Function` or `insertAdjacentHTML`. Double-submit guards are consistent:
`openModal`'s primary, `togglesInFlight`, `addingReminder`, and the Circle/Family buttons all disable
themselves before they await. Listener hygiene is good too (Family/Circle `wasMounted`, mentorship
`onLive` removed in `onClose`, PTR's touchmove attached only for the length of a gesture).

| ID | Severity | Effort | Title |
|---|---|---|---|
| JQ-01 | High | M | `logout()` and `handleAuthExpired()` reset different halves of the session |
| JQ-02 | High | S | Signing out from Settings, or a 401 while a dialog is open, leaves the dialog up over the sign-in screen |
| JQ-03 | Medium | M | Responses for a signed-out account still land in `state` and the cache |
| JQ-04 | Medium | M | Four copies of "share or download a file". Only the story card works in the app |
| JQ-05 | Medium | S | The 5-minute money retry is only armed when the page boots already signed in |
| JQ-06 | Medium | S | The voice language lives in raw `localStorage`, unguarded, beside the storage layer |
| JQ-07 | Medium | M | "Today" is computed in ten places, and they disagree on the timezone |
| JQ-08 | Low | S | GET de-duplication is keyed on the path alone and ignores the request options |
| JQ-09 | Low | S | Notification rollbacks restore a snapshot and erase anything that arrived meanwhile |
| JQ-10 | Low | S | Circle's people search drops server results after a quick type-and-delete |
| JQ-11 | Low | S | Family's user search shows whichever answer comes back last |
| JQ-12 | Low | S | `circle-core.js` `shiftDay` goes through UTC and is a day off east of UTC+12 |
| JQ-13 | Low | S | Suspected: "Print" on the shopping list does nothing in the Android app |
| JQ-14 | Low | S | `push.js` `pushPermission` is exported and never used |

---

### JQ-01: `logout()` and `handleAuthExpired()` reset different halves of the session
- **Severity:** High. **Effort:** M.
- **Where:** `scripts/app.js`, `logout` and `handleAuthExpired`.
- **What:** two hand-maintained reset lists that have drifted apart:
  - `logout` never clears `state.goals`, `state.wellness`, `state.trends`, `state.water`,
    `state.food`, `state.streakFreeze`, `state.calendarFood*` or `state.toasts`, and it never calls
    `setNotifFirstPage([])`.
  - `handleAuthExpired` never calls `cancelPendingLocalNotifications`, `resetFocusSession`
    (timer.js), `purgeUserCache` or `popoverCleanup`, never deletes `caches.delete('gb-api-get')`,
    never bumps `weekGen`, and never resets `recentFoods` / `favouriteFoods`.
  - Neither one clears `state.weeklyReviews`, `calendar.js` `cachedForm` (a half-typed reminder) or
    `_inflightGets`.
- **Failure:**
  - **Shared device:** A logs out and B signs in. B's first Home paint (after wave 1) shows A's goals
    widget, A's bell notifications and A's water and food totals until wave 2 lands.
    `loadSecondaryData` only overwrites a field when its own GET succeeded (`if (goals) …`), so if one
    of B's wave-2 calls fails, A's data stays for the whole session.
  - **Undo toast:** an Undo toast from A survives onto the sign-in card. Tapping it sends a request
    with no token.
  - **Session expiry:** a running focus timer keeps going, then posts its session under whoever signs
    in next. A's device alarms keep ringing until B's wave 1 re-syncs them.
- **Fix:** one `resetSession({ reason })` that both call. Build it from `initialState()` (or the
  literal `state` defaults) rather than from a list of fields, so a new field is reset by default.

### JQ-02: Signing out from Settings, or a 401 while a dialog is open, leaves the dialog up over the sign-in screen
- **Severity:** High. **Effort:** S.
- **Where:** `app.js` `openProfileSettings` → `accountPane` "Sign out" (`onclick: () => logout()`),
  `logout`, `handleAuthExpired`, and gb-kit `openOverlay` / `closeOverlays`.
- **What:** overlays are appended to `document.body`, and `render()` only replaces `root`. Only
  `setScreen` calls `closeOverlays()`. `logout` and `handleAuthExpired` both skip it.
- **Failure:**
  - **Settings sign-out:** Settings → Account → Sign out logs the user out underneath. The Settings
    sheet stays open on top of the sign-in card, still showing the previous account's name, email
    and profile fields. a11y.js keeps focus trapped inside the sheet. Tapping "Done" then PUTs with
    no token, gets a 401, and `handleAuthExpired` shows "Your session ended" right after a
    deliberate sign-out.
  - **Expiry mid-dialog:** the same happens to any open dialog (an expense, a note) when a request
    from it returns 401 (password changed on another device, "sign out everywhere").
- **Fix:** call `closeOverlays()` in the shared reset from JQ-01. For a note sheet, its `dismiss`
  commits; the shared reset should use `close` so nothing saves without a token.

### JQ-03: Responses for a signed-out account still land in `state` and the cache
- **Severity:** Medium. **Effort:** M.
- **Where:** `app.js` `loadData`, `loadSecondaryData`, `loadFavouriteFoods`, and `api` (the
  `_inflightGets` map).
- **What:** nothing checks, after an `await`, that the account that asked is still the signed-in
  one. The GET de-dup map is keyed by path and is never cleared on logout.
- **Failure:** this is likely on the Render free tier, where the first calls can take 30 s or more
  while the server wakes up.
  - **Logout during wave 1:** the user logs out while Home's wave 1 is still in flight. When it
    lands, it writes the old tasks and habits into `state`, sets `loadedFor` back to the old account,
    and starts `loadSecondaryData()`. Its GETs then go out with no token, return 401, and trigger
    `handleAuthExpired`, so the sign-in screen says "Your session ended. Sign in again."
  - **Money cached under a guest key:** if the money GET was in flight, `cacheMoney()` runs with
    `state.user === null`. `moneyStorageKey` then falls back to `gb.money.guest`, so the old
    account's ledger is stored under a key that `purgeUserCache` never removes.
  - **Next sign-in shares the old request:** if B signs in while one of A's GETs is still pending,
    B's `api('/api/tasks')` is handed A's promise from `_inflightGets`.
- **Fix:** have `api()` capture a `sessionEpoch` (bumped by the reset from JQ-01) and drop or reject
  any response whose epoch has changed. Clear `_inflightGets` in the reset.

### JQ-04: Four copies of "share or download a file". Only the story card works in the app
- **Severity:** Medium. **Effort:** M.
- **Where:**
  - `app.js`: `downloadMyData` and
    `exportRemindersIcs`.
  - `money.js`: `downloadLedgerCsv`.
  - `share-card.js`: `shareStoryCard` / `shareNatively`.
- **What:** all four build a Blob and then try a share sheet, falling back to an
  `<a download>` blob link. Only `share-card.js` has the native path (Filesystem + Share). Its own
  comment says that in the WebView `canShare({files})` is false. `MainActivity` in
  `../Growth-Buddy-Mobile` registers no `DownloadListener`, and an `<a download>` on a `blob:` URL
  is a no-op in a Capacitor WebView. `downloadLedgerCsv` does not even try `navigator.share`.
- **Failure:** in the Android app, "Download my data", "Export reminders (.ics)" and "Money CSV" all
  do nothing, then toast "…is downloading". The data export is the one a user is pointed at before
  deleting their account.
- **Fix:** export one `saveFile(blob, name, title)` from share-card.js (native → share → download)
  and have all four call it.

### JQ-05: The 5-minute money retry is only armed when the page boots already signed in
- **Severity:** Medium. **Effort:** S.
- **Where:** `app.js`, the module-level `if (state.user) { loadData(); setInterval(… persistMoney …) }`
  at boot.
- **Failure:** a user who signs in during the session never gets the re-push timer. That covers a
  fresh install, anyone after a logout, and anyone after a session expiry. Suppose a money save fails
  with a 5xx while still online (a waking server, which `persistMoney` reports as "Saved on this
  phone, will sync"). `handleOnline` never fires, because the device never went offline. The expense
  then waits for the next edit or a reload.
- **Fix:** start the interval unconditionally; its body already returns when `!state.user`.

### JQ-06: The voice language lives in raw `localStorage`, unguarded, beside the storage layer
- **Severity:** Medium. **Effort:** S.
- **Where:** `app.js` `hydrateUiPrefs` (`localStorage.setItem('gb.qa.lang', …)`), `speechLang`, and
  `openAddSheet` (`getItem` / `setItem`). Related: `cache-storage.js`, the legacy migration in
  `init()`.
- **What:** these are the only direct `localStorage` calls outside `cache-storage.js`, and they have
  no try/catch. `cache-storage.js` wraps every access because "localStorage unavailable" is a case
  it expects. The key also carries the `gb.` prefix, so on every boot `CacheStorage.init()`
  "migrates" it into Cache API storage and deletes it from `localStorage`. The value churns once per
  boot and has two sources of truth.
- **Failure:**
  - **Storage blocked:** where storage access throws (site data blocked, some embedded WebViews),
    `hydrateUiPrefs` throws inside `syncUserSession`, which sits on the sign-in path. Opening Quick
    add also throws, before the sheet is built.
  - **Two defaults:** `speechLang` falls back to raw `navigator.language` while Quick add matches it
    against `LANGS`, so the default language differs between the two mics.
- **Fix:** read and write `uiPrefs.qaLang` only (`saveUiPrefs` already persists it) and delete the
  three `localStorage` lines. This also brings it in line with the project's "persist to DB only"
  rule.

### JQ-07: "Today" is computed in ten places, and they disagree on the timezone
- **Severity:** Medium. **Effort:** M.
- **Where:**
  - `app.js`: `todayKey` and `todayKeyNow`, which are identical.
  - `dashboard.js`: the module `todayKey` and a second one inside the mini calendar.
  - `calendar.js` `todayKey`, `money-core.js` `todayKey`, `home-order.js` `localDayKey`,
    `push.js` `dayKey`, `review.js` `localKey`.
  - `goals.js` `todayKey`.
- **What:** `goals.js` deliberately uses the account timezone (`userZone`, matching the server's
  `UserClock`). Every other copy uses the device date.
- **Failure:** this is the code-level root of QA-06. For a traveller, or an account left on UTC,
  Goals and the rest of the app disagree about today. Goals' action picker allows a day that Home,
  Money and the calendar treat as tomorrow. A rest day or check-in sent with the device date is
  refused by the server.
- **Fix:** add one `todayKey(zone?)` (i18n.js or home-order.js already hold the pure date helpers),
  import it everywhere, and decide in one place which zone each caller means.

### JQ-08: GET de-duplication is keyed on the path alone and ignores the request options
- **Severity:** Low. **Effort:** S.
- **Where:** `app.js` `api` (`_inflightGets`).
- **What:** a second GET for the same path is handed the first one's promise, whatever its own
  options were. Its `onResponse` never runs, and its `raw` and `headers` are ignored.
- **Failure:** while `rollbackMoneyItems` has its plain `GET /api/money` in flight, the conflict
  branch of `putDocIfChanged` asks for `/api/money` with `onResponse: rememberMoneyVersion`. It gets
  the deduped promise, the ETag is never recorded, and the next `putMoney` sends a stale `If-Match`.
  That costs an extra 409 and merge round, plus a spurious "Merged money changes from your other
  device" toast.
- **Fix:** de-duplicate only when `opts` carries no `onResponse`, `raw` or custom `headers`, or
  include them in the key.

### JQ-09: Notification rollbacks restore a snapshot and erase anything that arrived meanwhile
- **Severity:** Low. **Effort:** S.
- **Where:** `app.js` `markAllNotificationsRead` and `clearReadNotifications`
  (`state.notifications = prev`).
- **Failure:** a socket push (`stomp` subscribe handler), or an older page from
  `loadOlderNotifs`, lands while the POST or DELETE is in flight. If the request then fails, the
  rollback restores `prev`: the new card vanishes from the bell and the older page is dropped.
- **Fix:** on failure, undo only what was changed. Put back `readAt: null` on the ids that were
  unread, or re-insert the removed ids, instead of assigning the snapshot.

### JQ-10: Circle's people search drops server results after a quick type-and-delete
- **Severity:** Low. **Effort:** S.
- **Where:** `circle.js`, the "Find someone" sheet's `queryInput` input handler (`lastQ`).
- **Failure:**
  1. Type "ab": the server results are painted and `lastQ` becomes "ab".
  2. Type "c": the timer for "abc" is queued, then cleared by the next keystroke.
  3. Within 220 ms, delete back to "ab": the timer sees `q === lastQ` and returns.
  The list now shows only the local matches, and the people found on the server for the same query
  disappear.
- **Fix:** cache the last server answer per query and repaint it instead of returning, or drop the
  `lastQ` short-circuit (`seq` already discards stale answers).

### JQ-11: Family's user search shows whichever answer comes back last
- **Severity:** Low. **Effort:** S.
- **Where:** `family.js` `doSearch`.
- **Failure:** the user presses Enter on "jo", then on "john". If the "jo" response arrives second,
  it replaces the "john" results. There is no sequence guard, unlike Circle's `seq`.
- **Fix:** add `const mine = ++seq` before the await and `if (mine !== seq) return` after it.

### JQ-12: `circle-core.js` `shiftDay` goes through UTC and is a day off east of UTC+12
- **Severity:** Low. **Effort:** S.
- **Where:** `circle-core.js` `shiftDay`, used by `winLines`.
- **What:** it builds local noon, then calls `toISOString().slice(0, 10)`. In UTC+12 to UTC+14
  (New Zealand in summer, Tonga, Kiribati), local noon is the previous day in UTC.
- **Failure:** "a goal finished in the last week" looks back 8 days instead of 7. This is the exact
  pitfall CODEMAP warns about for date keys.
- **Fix:** format with the local getters, as `home-order.js` `localDayKey` does, or import it (see
  JQ-07).

### JQ-13: Suspected: "Print" on the shopping list does nothing in the Android app
- **Severity:** Low. **Effort:** S.
- **Where:** `family.js` `printShopping`.
- **What:** the Android System WebView does not implement `window.print()` unless the host activity
  wires up `PrintManager`, and `MainActivity` does not. The code already hedges ("afterprint never
  fires in some WebViews").
- **Failure:** the button adds the print class, then removes it a second later, and nothing happens.
- **Fix:** hide the button when `isNative()`; "Copy" and "Share" already cover the use.

### JQ-14: `push.js` `pushPermission` is exported and never used
- **Severity:** Low. **Effort:** S.
- **Where:** `push.js` `pushPermission`.
- **What:** it has no references anywhere in `scripts/`. It is the only dead export found; a scan
  of every `export` and every top-level function found no other unused symbol.
- **Fix:** delete it.
