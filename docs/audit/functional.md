# Functional audit (build 88)

Static reading of the code only. No servers were run and no browser was used. Every `node scripts/*.test.mjs` passes, and none of them covers the cases below. Items already marked fixed in `bugs.txt` are left out. Severity and effort are given as Critical/High/Medium/Low and S/M/L. "Suspected" means the code path is plausible but not fully confirmed.

Summary: 0 Critical, 7 High, 4 Medium, 10 Low.

---

## High

### FN-01 Offline or failed Money document edits are lost on the next load, after "will sync" was promised
- **Severity:** High. **Effort:** M.
- **Where:** `scripts/app.js`, in `loadSecondaryData` (the `if (money)` block), `persistMoney` and `putDocIfChanged`.
- **Scenario:**
  1. The user changes something kept in the money document rather than in a ledger row, while offline or when the save gets a 5xx. Examples: a loan repayment, a goal contribution, marking a bill paid, budgets.
  2. `persistMoney` toasts "Saved on this phone — will sync".
  3. The next `loadData` (the online event, pull to refresh, or a relaunch) runs `state.money = normalizeMoney(overlayPending(money))` and resets `lastDocBody` to the server's copy. `overlayPending` replays only expense, income and transfer rows, so the document edit is dropped and never re-sent.
- **Result:**
  - The repayment's transfer is posted while the loan still shows as outstanding.
  - A bill marked paid is due again.
- **Fix:** persist a "document not yet accepted" flag beside `.pending`. While it is set, merge the cached document into the server's copy and re-PUT it instead of replacing it.

### FN-02 Sleep and mood entries that fail to sync are silently wiped
- **Severity:** High. **Effort:** M.
- **Where:** `scripts/app.js`, `saveSleepEntry` / `saveMoodEntry` (Home's sleep confirm, quick mood, and both dialogs), and the `dailyLogs` block in `loadSecondaryData`.
- **Scenario:**
  1. The user logs sleep or mood offline, or while Render is waking and answers 502/503.
  2. The toast says "Saved locally, but could not sync". Nothing queues the write.
  3. The next `loadData` sets `sleepByDate` / `moodByDate` to the server's `dailyLogs` and `persistWellness()` overwrites the cache. The entry is gone without a word.
- A 4xx refusal shows the same "saved locally" text, though it will never sync.
- **Fix:** route both POSTs through the outbox (`queueWrite`); both are upserts by date, so a replay is safe. Overlay pending entries in `loadSecondaryData`. On a 4xx, roll back and show a real error.

### FN-03 `saveUiPrefs` PUTs the whole stale prefs blob and reverts other devices' settings
- **Severity:** High. **Effort:** S.
- **Where:** `scripts/app.js` `saveUiPrefs`. Server side, `AuthService.updateUiPrefs` already merges key by key.
- **Scenario:**
  1. Device A has been open since yesterday. Device B then edits `taskTemplates`, the water settings or the focus goal.
  2. A toggles any pref. It sends `{prefs: state.user.uiPrefs}` with every key, so A's old values overwrite B's on the server.
- **Same-device race:** `refreshCurrentUser` runs after every task or habit toggle and replaces `uiPrefs` wholesale from `/me`. If that answer lands before an in-flight PUT commits, the pref flips back locally, and the next save writes the old value.
- **Silent failure:** a failed save only logs to the console, so the user believes it saved.
- **Fix:** send `{prefs: patch}`. Toast when the save fails.

### FN-04 Logout leaves the previous account's data in memory for the next sign-in in the same tab
- **Severity:** High. **Effort:** S.
- **Where:** `scripts/app.js` `logout`. Compare `handleAuthExpired`, which resets these.
- **What is never reset:** `state.calendarFoodByDate`, `goals`, `notifications`, `food`, `water`, `weeklyReviews`, `notifFilter`, `pendingWater`, `yesterdayAsked` and `_inflightGets`.
- **Scenario:** account A logs out and B signs in without a reload.
  - `loadCalendarFoodForDate` skips days already cached, so B's Calendar shows A's food.
  - "Copy yesterday's ..." offers A's meals.
  - Until wave 2 lands, or for good if a call in it fails, B sees A's goals and bell. Tapping one of A's notifications gives a 404 toast.
  - `pendingWater` adds A's unsent millilitres to B's water card. Meanwhile `purgeUserCache` deleted A's water queue, so A loses those glasses.
- **Fix:** have `logout()` share `handleAuthExpired`'s state reset, and also clear `pendingWater`, `yesterdayAsked` and `_inflightGets`.

### FN-05 The Money conflict merge reverts local edits to existing items and brings deleted budgets and tags back
- **Severity:** High. **Effort:** M.
- **Where:** `scripts/money-core.js` `mergeMoney`. It is reached from `putDocIfChanged` on a 409, on every save after a failed boot load, and from Settings' bank "Sync now".
- **Scenario:**
  1. The server copy changes first, for example a WhatsApp "Mark as paid" (which writes with no version check) or another device's save.
  2. The user adds a goal contribution or edits a subscription. The save gets a 409.
  3. The merge starts from the server's copy and adds only the local items it does not have, so the edit to an existing goal or loan is dropped. Only `paidFor` and `postedFor` are protected.
  4. The merged copy is saved and the user is told "Merged money changes".
- **Related:**
  - A budget cleared to 0 has its key deleted, so the merge restores it.
  - `customCategories` has no tombstones, so a deleted tag returns.
- **Fix:**
  - Merge item by item, letting the newer copy win (stamp `updatedAt` in `commitOn`).
  - Store a cleared budget as `null`.
  - Add `customCategories` to `TOMBSTONED`.

### FN-06 A Money save built from a stale copy replaces the whole live document
- **Severity:** High. It depends on timing. **Effort:** S.
- **Where:** `scripts/app.js` `saveMoney`, at `Object.assign(applyLedgerDiff(state.money, diff), docPart(nextN), ...)`.
- **Scenario:**
  1. On a slow network the user opens Home's "Add expense". `money-home.js` `addExpense` works from the cached copy Home rendered with.
  2. Wave 2 then loads the server's document, including a goal added on the laptop.
  3. The user saves. Ledger rows are compared correctly, but the stale `docPart` overwrites the live one whole.
  4. The version matches, so the server accepts it. The laptop's goal is lost.
- The same happens with any Money dialog left open across a conflict merge or a bank sync.
- **Fix:** diff the document too. Apply only the top-level keys that changed between the base copy and the new one, the way `applyLedgerDiff` does for ledger rows.

### FN-07 A focus session linked to a deleted or swept task or goal is lost, and so is every later one
- **Severity:** High. **Effort:** S.
- **Where:** `scripts/timer.js` `postSession` and `T.link`. Server side, `FocusService.record` throws `ApiException.notFound("that task")` when `links.ownsTask` / `ownsGoal` fails (it requires `deletedAt is null`).
- **Scenario:** the user starts focus on a task. The task is then deleted, or ticked and soft-deleted by `TaskMidnightSweep`, or the session finishes while the app is closed and posts at the next boot.
- **Result:**
  - `POST /api/focus/sessions` returns 404. The toast shows and the minutes are not recorded.
  - `T.link` is persisted with the timer and never cleared, so every later session fails the same way until the user changes the picker by hand. A deleted goal does the same.
- **Fix:** in `FocusService.record`, save the session with the link set to null instead of returning 404. Or, on the client, retry once without the link and clear `T.link` when it is not in `Focus.targets`.

---

## Medium

### FN-08 A live habit tap while an offline check-in is still queued sets the opposite state
- **Severity:** Medium. **Effort:** S.
- **Where:** `scripts/app.js` `plainToggleHabit`.
- **Scenario:**
  1. The user ticks a habit offline, which queues `POST /checkin {date, done:true}`.
  2. They come back online, but the flush is stalled (a 502, a 429, or a 5xx on an earlier op).
  3. They tap again to un-tick. The live `PATCH /toggle` flips the server from not done to done, and the answer paints the row as ticked, the opposite of the tap.
  4. The queued `done:true` then replays as well.
- **Fix:** send the live write as a dated `/checkin {date, done}` instead of the stateless `/toggle`. Or route the tap through `queueWrite` while a `habit:<id>:<day>` op is queued, where the two cancel.

### FN-09 Editing, pausing, completing or snoozing an item created offline sends a temp id and fails with 400
- **Severity:** Medium. **Effort:** S.
- **Where:** `scripts/app.js`:
  - `updateTask`, `patchTaskNow` / `pauseTask`;
  - `toggleReminderDone`, `editReminder`, `snoozeReminder`.
- **Scenario:**
  1. A task or one-off reminder is created offline and carries a `tmp-...` id.
  2. These functions build the path from the raw id, with no `realId()` and no outbox branch.
  3. `PUT /api/tasks/tmp-...` fails the UUID path binding and returns 400 "Bad Request". Pause rolls back.
- It also happens online, after the create synced, if the dialog was opened while the id was still temporary.
- **Fix:** use `realId(id)`. While the id is still temporary, queue the write (the outbox rewrites temp ids in later ops) or disable the row actions, as Notes already does.

### FN-10 Focus on a task created offline posts `taskId: "tmp-..."`, and the session is lost
- **Severity:** Medium. **Effort:** S.
- **Where:** `scripts/app.js` `focusProps` / `onFocusSession`, `scripts/timer.js` `postSession`, and `FocusController.SessionRequest(UUID taskId)`.
- **Scenario:**
  1. The user starts focus on a task that has not synced yet.
  2. The POST fails UUID deserialisation with a 400, and the minutes are dropped.
  3. `T.link` keeps the temp id after the task syncs, so later sessions fail too (see FN-07).
- **Fix:** send `realId(link.taskId)`, and leave out a link that is still a temp id.

### FN-11 A failed first Mentorship load says "No mentors or mentees yet" and hides pending requests
- **Severity:** Medium. **Effort:** S.
- **Where:** `scripts/circle.js` `ScreenCircle` → `refreshAll` / `paint`.
- **Scenario:**
  1. The user opens Circle offline or on a 5xx.
  2. `onLoadOutgoing().catch(() => cachedOutgoing)` and its incoming twin return `[]`, because the caches start empty.
  3. The empty state shows, "Requests for you" is dropped, and there is no retry. A user with mentors and a waiting invite is told they have none, until a `gb:circle-changed` event arrives or they leave and come back.
- **Fix:** track a first-load failure and paint an error line with Try again instead of the empty state.

---

## Low

### FN-12 (Suspected) The water queue is read before CacheStorage hydrates and can overwrite last session's offline glasses
- **Where:** `scripts/app.js` `loadWaterQueue`, `storeWaterQueue`, `restoreWaterQueue`, `flushWaterQueue`.
- **Scenario:**
  1. The outbox awaits `CacheStorage.ready()`; the water queue (`<money key>.water`, a Cache-API-only key) does not.
  2. A tap or `restoreWaterQueue` that runs before `init()` resolves reads `[]`.
  3. The next write persists only the new glass. `hydrate()` will not restore the old value, because the key is already in memory.
- **To confirm:** time `CacheStorage.init()` against wave 1 on a slow device.
- **Fix:** `await CacheStorage.ready()` in the restore and flush paths, and before the first store.
- **Effort:** S.

### FN-13 The 5-minute Money re-push is never registered when the user signs in during the session
- **Where:** `scripts/app.js`, the boot block. The `setInterval(... persistMoney ...)` sits inside `if (state.user)` at module load.
- **Scenario:** after a first sign-in, or a sign-in after logout in the same tab, a ledger save that got a 5xx while online waits for an `online` event that never comes, until the next reload.
- **Fix:** register the interval unconditionally. It already checks `state.user`.
- **Effort:** S.

### FN-14 Login treats every 403 as "email not verified"
- **Where:**
  - `scripts/app.js` `viewSignin`: `if (err.status !== 403) throw err` → `setAuthMode('verify')`;
  - `AuthService.login`, which throws `ApiException.forbidden` with no code.
- **Scenario:** any other 403 on `/api/auth/login`, such as a CORS rejection for a missing Capacitor origin, opens the OTP screen saying a fresh code was sent. No code was sent, so the user loops.
- **Fix:** emit code `email_unverified` on the server, and branch on `err.code` in the client.
- **Effort:** S.

### FN-15 Delete does nothing on a water entry that has not synced
- **Where:** `scripts/app.js` `deleteWaterEntry` (`if (pendingWater.has(entryId)) return;`).
- **Scenario:** a glass logged offline shows its delete control. A tap returns silently, with no confirm and no toast. A mis-tap cannot be undone, and it syncs later anyway.
- **Fix:** remove the entry from `pendingWater` and the queue and repaint. If its POST is in flight, toast "Still saving".
- **Effort:** S.

### FN-16 "Money changes were not saved" is shown for writes that are actually still queued
- **Where:** `scripts/app.js`, the `persistMoney` catch together with `flushLedger` / `RETRYABLE`.
- **Scenario:** `flushLedger` keeps the batch on 401, 408, 409 (`idempotency_in_progress`) and 429, but the toast treats only offline and 5xx as queued. The user re-enters the expense under a new id, and both land.
- **Fix:** treat `RETRYABLE.has(err.status)` as queued when choosing the toast.
- **Effort:** S.

### FN-17 Quick-add expenses drop paise and book to no account
- **Where:** `scripts/app.js` `addQuickExpense` / `addQuickIncome`.
- **Scenario:** "spent 49.50 on coffee" is stored as 50 (`Math.round`). No account is set, so the entry never moves an account balance, unlike the Money form, which defaults to `settings.lastAccountId`.
- **Fix:** `Math.round(amount * 100) / 100`, and default the account to `lastAccountId`.
- **Effort:** S.

### FN-18 The mentorship agreement checklist: a failed save rolls back over a later successful one
- **Where:** `scripts/circle.js` `AgreementList` → `save()`.
- **Scenario:**
  1. The user ticks A, then B, while the first PUT is in flight. Each PUT carries the whole list.
  2. Save 1 fails after save 2 succeeded, and `items = before` restores the list from before both ticks.
  3. The next edit saves that stale list and un-ticks both items for both partners.
- **Fix:** roll back only when the failed save is the newest (a sequence number), or re-parse the last list the server accepted.
- **Effort:** S.

### FN-19 A failed "Load older" in a circle feed wipes the posts already shown
- **Where:** `scripts/circle.js` `PostsFeed` → `load(before)` `.catch`.
- **Scenario:** `list.replaceChildren(error, Try again)` replaces every loaded post with the error, so the feed goes blank.
- **Fix:** when `before` is set and posts are already shown, toast the error and keep the list.
- **Effort:** S.

### FN-20 Reassigning a chore that fails to save still shows the new assignee
- **Where:** `scripts/family.js` `choreRow`, the reassign `select` → `run()`.
- **Scenario:**
  1. The user reassigns offline or on a 403. `run()` toasts, does not repaint, and reverts only checkboxes.
  2. The select keeps the new name, so the user believes the chore was handed over. A reload silently reverts it.
- **Fix:** on failure, reset `select.value` to `c.assigneeMemberId || ''`.
- **Effort:** S.

### FN-21 (Suspected) Undoing a deleted shopping item can tick the wrong row
- **Where:** `scripts/family.js` `restoreShopping`.
- **Scenario:**
  1. The list has two unchecked "Milk" rows, and the user deletes a checked "Milk" and taps Undo.
  2. `res.items.find(x => x.name === it.name && !x.checked)` picks the first unchecked Milk, which may be an older row, and ticks it.
- **To confirm:** check the order in which `FamilyService.addShopping` returns items, and whether it dedupes by name.
- **Fix:** pick the item whose id was not in the list before the add, or return the created id from POST `/shopping`.
- **Effort:** S.

---

## Checked and found consistent (no finding)

- **Family, Circle and Mentor:** every wrapper's path, method and body field names match the controllers.
- **Notes:** the routes, the 204s, the 409 conflict flow and delete with Undo work.
- **Reminders:** the create and update fields match, including `notifyBefore2`.
- **Focus, notes, goals and reminders:** every void handler returns 204.
- **Auth error codes:** `totp_required` / `deletion_scheduled` go through `authPost`, so the 401 → logout path cannot catch them.
- **Water:** idempotency keys are stable across replays.
- **Money:** ledger field mapping and "Load older" paging match the server.
- **Device alarms:** paused habits are filtered out of the alarm queue.
