# Offline and data-integrity audit (prefix OFF)

Build 92, branch overhaul/2026-10-11, 2026-10-11. Auditor: offline-integrity.

## Method

- Production bundle (`vite build` to the scratchpad, `vite preview --port 5592` proxied to the shared
  backend :8591), so the service worker, its precache and the `gb-api-get` NetworkFirst cache are in
  play the way they are for a real user. Dev server :5591 used only for readable stack traces.
- Playwright over CDP (:9591), one fresh seeded account per scenario, every write checked against the
  API with that account's token (`snap()`: tasks, habit ticks, notes, reminders, ledger expenses,
  today's water).
- **Harness note for whoever repeats this:** on this shared Chrome, `context.setOffline(true)` and
  `Network.emulateNetworkConditions({offline:true})` both flip back to online after 2 to 15 s (an
  `online` event fires on its own), and `page.route()` stalls page loads over `connectOverCDP`. A
  first run therefore looked like "nothing syncs when the connection returns"; that was the harness,
  not the app. The runs below use CDP `Fetch.failRequest(InternetDisconnected)` on `/api/` and `/ws/`
  for the page AND the service worker target, plus an init script that drives `navigator.onLine` and
  the `online`/`offline` events from the test's own flag. Scripts: `lib.mjs` (`sim`, `simSetup`,
  `simPage`, `swFetchHook`), `s1.mjs`, `r1.mjs`, `m1.mjs`, `t1.mjs`/`t3.mjs`, `sl1.mjs`, `x1.mjs`,
  `l1.mjs`, `c1.mjs` under
  `/private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/off/`.

## What held (verified, no finding)

- Offline then online (`s1.mjs`, account accA3): task create, task toggle, task delete, habit tick
  (replayed as a dated `POST /checkin`), text note create, one-off reminder create, whole-series
  reminder delete, expense, water glass. After reconnect each landed exactly once; nothing else was
  deleted. Offline reload in between kept all of them queued (outbox, money pending, water queue).
- Lost answers (`l1.mjs`): the request reached the server and the response was dropped
  (`Fetch` at Response stage). Water and reminder were queued with the same `Idempotency-Key` and the
  replay produced one row each.
- Slow network (`sl1.mjs`, every API call held 2.5 s): double-click on Add task, Add expense and Add
  reminder produced one row each; 250 + 500 ml taps produced two entries, 750 ml.
- Two tabs, same note (`t1.mjs`): tab 2's save got 409 and the "This note changed elsewhere" dialog
  (Save mine over it / Load the newer one / Keep editing); server kept tab 1's text, no silent
  overwrite. Evidence `docs/evidence/audit-offline/t1-note-conflict-tab2.jpg`.
- Two tabs, same Money doc (`t3.mjs`): both tabs' new expenses kept; a delete from the stale tab
  removed only its own expense.
- Sign out and sign in as B (`x1.mjs`): B's Home, Money, Notes composer and server data carry none of
  A's tasks, expense or note draft; no queued write of A's was sent with B's token. Exception: OFF-2.

## Findings

### OFF-1: A write still in flight when the page reloads or closes is lost, with a success already shown
- Severity: High
- Where: scripts/app.js `createTask`, `toggleTask`, `plainToggleHabit`, `addReminder`, `quickAddWater` (desktop and phone; any screen)
- Repro / evidence: `m1.mjs` (account accM). Each write's request is held 1.5 s (a slow or flaky
  link), the page reloads 200 ms after the tap. Before: 3 tasks, "Read 20 pages" unticked, water 500 ml,
  2 reminders. After every step: task "MID task" absent, "Renew passport" not done, habit not ticked,
  water still 500 ml / 1 entry, reminder "MID reminder" absent. The UI had painted each one as done
  ("Task added." toast, ticked check, glass on the card). The expense ("MID expense", 55) survived and
  was sent after the reload, because Money writes its pending queue before the request. The note
  survived only as a composer draft (reopened with the text, not saved).
- Cause: these writes enter the outbox / water queue only in the `catch` of the live request
  (`networkError(err)` / `offlineError(err)`). A page that unloads (reload, tab close, the phone
  killing the app on a slow network) never reaches the `catch`, so nothing is persisted. Money is safe
  because `saveMoney` calls `queueLedger(diff)` before `persistMoney()`.
- Fix: write-ahead, the Money pattern, in app.js: enqueue the op (with the per-tap `idemKey` the live
  request already sends) before the request, remove it on success, leave it on a network error. The
  server's `Idempotency-Key` replay makes a duplicate send harmless. Same for `quickAddWater`:
  `storeWaterQueue(...concat(glass))` before the POST, drop it in the success branch. `outbox.js`
  needs a "mark as being sent" so `flush()` does not resend the op whose live request is still out
  (it already tracks `sendingId`).

### OFF-2: Account A's unsynced water glass shows on account B after logout, and B's daily snapshot is sent with it
- Severity: High
- Where: scripts/app.js `resetUserState` / `purgeUserCache` (the `pendingWater` Map); Food screen and Home water card, desktop
- Repro / evidence: `x1.mjs`. A (accX) goes offline, taps +750 ml, logs out (still offline), the
  connection returns, B (accY, server water 500 ml / 1 entry) signs in through the form on the same
  tab. B's water card reads "1,250ml of 2,000 ml" with entries "23:47 750 ml" (A's glass) and
  "23:43 500 ml" (`docs/evidence/audit-offline/x1-B-food.jpg`). B's session then sent
  `POST /api/daily-logs/snapshot {"date":"2026-10-11",...,"waterMl":1250,...}` under B's token (204);
  `WellnessService.snapshot` stores the client's `waterMl` as given. A later snapshot happened to
  overwrite it in this run, so the stored value is a race, not a guarantee. The glass itself was not
  POSTed to B (B's water queue key is B's own).
- Cause: `pendingWater` (app.js, `const pendingWater = new Map()`) is module memory. `purgeUserCache`
  removes A's persisted water queue, but nothing clears the Map, and `withPendingWater` lays it over
  every later water summary, including the next account's.
- Fix: `pendingWater.clear()` in `resetUserState()` (the one list of per-account memory), with
  `lastWaterTap` and `waterRefetch` reset beside it. Add an assert in `app-logic.test.mjs` or a
  comment at `resetUserState` so a new per-account Map is not forgotten again.

### OFF-3: Logging out with offline changes queued throws them away without a word
- Severity: Medium
- Where: scripts/app.js `logout` -> `purgeUserCache` (`outbox.clear()`, the water queue key); profile menu, desktop
- Repro / evidence: `x1.mjs`. Offline, A creates "A-ONLY task", ticks "Read 20 pages", adds 750 ml and
  a 444 expense. The profile menu shows "2 changes waiting to sync". Log out is one tap, no prompt.
  After sign-out the Cache API holds only `gb.money.<A>.pending`; A's server data afterwards: no
  "A-ONLY task", habit unticked, water 500 ml (the glass is gone too). Only the expense is kept for A's
  next sign-in.
- Cause: deliberate (comment in `purgeUserCache`: "a task tick replayed into a later session is worth
  less than a clean sign-out"), but the user is never told, and the chip a tap away says those changes
  are waiting to sync.
- Fix: in `logout()`, when `outbox.size()` or `loadWaterQueue().length` is non-zero, ask first
  ("2 changes haven't synced yet. Log out and discard them?" with Stay signed in as the default),
  and if online try `flushOutbox()` + `flushWaterQueue()` before purging. app.js only.

### OFF-4: After a reload, a queued glass of water can vanish from the card and is not replayed at boot
- Severity: Medium
- Where: scripts/app.js `loadData` wave 1 (`restoreWaterQueue(); state.water = withPendingWater(water); flushWaterQueue();`); Food screen, desktop
- Repro / evidence: `r1.mjs` (accA3). Offline, water 750 -> tap +250 -> 1,000 ml. Reload offline:
  first reload shows 750 ml and makes no `POST /api/water/entries` attempt; the second reload shows
  1,000 ml and does attempt it. The glass is still in storage and is sent on the next `online`.
- Cause: wave 1 reads the water queue (`loadWaterQueue`, a Cache-API-only key) before
  `await CacheStorage.ready()`, which loadData only awaits a few lines later for the outbox. Before
  hydration the key reads as absent. The same pre-hydration read exists on the write side
  (`storeWaterQueue(loadWaterQueue().concat(...))`, and `queueLedger` -> `loadPendingLedger` in
  `saveMoney`): a write made in that window would replace the persisted queue with a one-item queue
  (from reading the code; the window is short and was not hit in these runs).
- Fix: move `await CacheStorage.ready()` above `restoreWaterQueue()` in `loadData` (it resolves fast
  after first boot), and make `quickAddWater`'s queue write and `queueLedger` go through an
  `await CacheStorage.ready()` the way `queueWrite` already does.

### OFF-5: An edit from a stale tab or device brings back an expense that was deleted elsewhere
- Severity: Medium
- Where: backend `money/MoneyLedger.apply` (`INSERT ... ON DUPLICATE KEY UPDATE` + hard `DELETE`); Money > Spending, desktop, two tabs
- Repro / evidence: `t3.mjs` (accT2). Tab 1 adds "E1 shared" 11. Tab 2 opens Money (sees E1), adds
  "E2 from T2". Tab 1 deletes E1 -> server: [E2]. Tab 2, not reloaded, edits E1's amount to 99 and
  saves -> `POST /api/money/tx` 200, no toast -> server: [E1 shared 99, E2]. The delete is undone
  silently. The same happens when an edit queued offline on a phone replays after the laptop deleted
  that row.
- Cause: a ledger upsert carries no version and the server keeps no record of deleted ids, so an
  upsert of a deleted id is a fresh insert.
- Fix: keep deleted ledger ids (a `deleted_at` column on `money_transactions` filtered out of reads,
  or a small `money_tx_tombstones` table; new column means `tableCreationQueries.sql` + `migrations.sql`)
  and have `MoneyService.applyLedger` return such ids in `rejected` with reason "deleted on another
  device"; the client already rolls those back (`rollbackMoneyItems`) and toasts.

### OFF-6: Opening a not-yet-loaded screen offline on a first visit reloads into the browser's offline error page
- Severity: Medium
- Where: scripts/app.js lazy screen loader `.catch` (`isStaleChunkError` -> `location.reload()`); vite.config.js workbox options; any lazy screen (Notes, Money, Goals, Report...)
- Repro / evidence: `c1.mjs`. Sign in on a fresh browser profile (service worker installed, not yet
  controlling: no `clientsClaim`), lose the connection, open Notes. Console: `Screen failed to load
  TypeError: Failed to fetch dynamically imported module: .../assets/notes-*.js`, then the tab
  navigates to `chrome-error://chromewebdata/`: the app is gone, the user sees the browser's offline
  page (`docs/evidence/audit-offline/c1-offline-lazy-chunk.jpg`). Queued writes survive (they are
  persisted), but the app cannot be reopened until the network returns.
- Cause: a failed dynamic import offline is read as a stale deploy and answered with a reload, which
  cannot succeed offline without a controlling worker.
- Fix: in the loader's `.catch`, reload only when `navigator.onLine`; offline, show the crash card
  with "This screen needs a connection the first time" and retry on `online`. Optionally add
  `clientsClaim: true` to the workbox config so the first visit is controlled once the precache is in.

### OFF-7: Logging out offline never revokes the session token on the server
- Severity: Low
- Where: scripts/app.js `logout` (fire-and-forget `POST /api/auth/logout`)
- Repro / evidence: `x1.mjs`: the logout POST failed with `net::ERR_INTERNET_DISCONNECTED` and is not
  retried; afterwards `GET /api/auth/me` with that token still answers 200 with A's account.
- Cause: the revoke is attempted once, and the token is deleted locally either way.
- Fix: when the revoke fails, keep the token under a `gb.revoke.pending` key (not a session) and send
  `POST /api/auth/logout` with it on the next `online` or next boot, then drop it. app.js only.

### OFF-8: Signed-out account's unsynced expenses stay readable on the device
- Severity: Low
- Where: scripts/app.js `purgeUserCache` (keeps `gb.money.<uid>.pending`)
- Repro / evidence: `x1.mjs`: after A logs out, the Cache API `gb-store-v2` still holds
  `gb.money.<A>.pending` with A's expense (amount 444, note "A-ONLY expense") while B uses the browser.
- Cause: deliberate, so the only copy of an unsent expense is not lost.
- Fix: pair it with OFF-3's prompt (most people will choose to stay signed in and sync), and say in
  the prompt that unsynced expenses stay on this device until that account signs in again.

### OFF-9: Edits made offline are refused while creates are "saved on this phone"
- Severity: Low
- Where: scripts/app.js `updateTask`, `deleteReminder` (scopes other than `all`), notes.js edit sheet (offline: "editing disabled")
- Repro / evidence: `s1.mjs`: offline, renaming "Plan this week" gives "You're offline, so that didn't
  go through" and the dialog stays open with the text (nothing lost); deleting "Call mom" with
  "This & all future" gives the same, while "Delete whole series" and new tasks / reminders / notes
  are queued with "Saved on this phone". The rule (six queued writes, CODEMAP `outbox.js`) is not
  visible to the user.
- Cause: only six writes are wired to the outbox.
- Fix: queue `PUT /api/tasks/{id}` and the other reminder delete scopes through `queueWrite` (the
  outbox already collapses and rewrites temp ids); until then, disable those controls offline with a
  short reason instead of letting the tap fail.

### OFF-10: Notes opened offline for the first time shows a "saved copy" without the user's notes
- Severity: Low
- Where: scripts/notes.js `showOffline` / `saveOffline`; Notes, desktop
- Repro / evidence: `s1.mjs` first run (accA2, Notes never opened online in that browser): offline
  reload, Notes shows "Offline — showing saved copy, editing disabled" with only the note just created
  offline; the account's existing note "Ideas for the trip" is not listed. Once Notes has been opened
  online (`n1.mjs`), the offline view lists it (`docs/evidence/audit-offline/n1-notes-offline-revisit.jpg`).
- Cause: the offline copy is written only when the Notes list loads online.
- Fix: when no offline copy exists, say so ("Your notes haven't been saved to this device yet") rather
  than presenting the queued ones as the saved copy; optionally write the copy from the boot data.

## Counts

High 2, Medium 4, Low 4.
