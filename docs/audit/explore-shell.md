# Explore: Home, Habits, Tasks, Achievements, app shell (prefix EXS)

Explored on 2026-10-11 23:00 to 2026-10-12 00:05 IST against the shared stack (Vite :5591, backend :8591,
CDP Chrome :9591), build 92. I drove the app with throwaway Playwright scripts attached over CDP (kept in
the session scratchpad `exs/`, `t1.mjs` to `t42.mjs`), at 1280x800 and 390x844. Accounts: several fresh
seeded ones (`e2e/seed.mjs`), one `--empty` account, and two accounts created through the real sign-up form.
Screenshots are in `docs/evidence/audit-explore-shell/`.

Percentages are measured: the flows I ran in each area, and the share that behaved correctly end to end,
including a reload where the data should persist.

| Feature | Measured completion % | Evidence |
|---|---|---|
| Tasks (Home list + dialog) | 100% (11/11) | Add, empty-title validation, priority, due date (local 10:30 saved as 05:00Z), goal link, check, uncheck, pause (Resume shows), edit, delete with confirm, reload persistence, templates sheet. `task-*.jpg`. No undo after delete (a confirm is asked first, so not filed). |
| Habits screen | 80% (8/10) | Add (name validation, weekly, category), check/uncheck, rest day (spends a freeze), rename, pause, delete with confirm, reorder persists across reload. Failures: EXS-1 (`null` in the Edit dialog), EXS-7 (paused habit counted). `habit*.jpg`. |
| Streaks, freezes, XP | 75% (3/4) | Streak goes 0 to 1 and back on check/uncheck; freeze spent by rest day; weekly freeze refill seen at Monday 00:00. Failure: EXS-9 (un-tick keeps best streak and XP). |
| Achievements | 100% (3/3) | Opens from the account panel, counts match XP and level, empty account shows 0 of 19. Read-only screen. `achievements-*.jpg`, `empty-achievements-*.jpg`. |
| Header: quick add, bell, account panel | 90% (9/10) | All three open, close on Escape and backdrop, panel items route correctly (Achievements, Weekly review, Settings, Log out). Failure: EXS-6 (the timezone offer stacks over an open dialog). Notes: EXS-12. |
| Command box (quick add free text) | 78% (7/9) | Empty input, "buy milk tomorrow", "spent 200 on lunch", "drank 500 ml water", "open money", "dark mode", gibberish (says so in a toast), "finished Read 20 pages" all worked and saved. Failure: "remind me at 9pm to call mom" after 9pm (EXS-5). Copy: EXS-10. `cmd-*.jpg`. |
| Settings | 80% (8/10) | Profile name with Cancel (not saved) and with Done (saved); text size, time format and theme persist across reload and to the server; features on/off hide and show the nav tab, Home cards, quick-add options and redirect `#/habits` to Home; home cards, bottom bar and reminders tabs render. Failures: EXS-2 (retention picker), EXS-8 (stale score ring). Related: EXS-3, EXS-14, EXS-15. |
| Auth views | 92% (11/12) | Sign out (cookies cleared, token revoked), signed-out deep link shows sign-in, wrong password message, empty submit validation, sign-in returns to the deep link (`#/habits`); sign-up validation (short, mismatch), wrong and right OTP; forgot password with an unknown email (does not reveal whether an account exists) and a real one, new password signs in. Failure: EXS-4 (sign-up 500 under concurrent sign-ups). Copy: EXS-11. `signin-*.jpg`, `signup-*.jpg`, `forgot-*.jpg`. |
| First-run setup + onboarding card | 90% | Three steps walk through, notification denial is explained in a toast, features step saves. Copy: EXS-13. `firstrun-*.jpg`. |
| Weekly review | 100% (3/3) | Banner opens it, Save stores both fields, banner gone after reload, reopening from the account panel shows the saved text with "Update review". `weekly-review-desktop.jpg`. |
| Phone width (390x844) | 100% of screens fit | No horizontal overflow on Home, Habits, Achievements, the habit dialog, quick add, the More sheet, the account panel or any Settings tab, including at the Largest text size. Small visual controls (30px task actions, the 34x25 "+ Add") get 44px hit areas from the `::before` rule in `styles/app.css`. `*-mobile.jpg`. |

No console errors or 4xx/5xx came from the app in any run apart from the two expected 400s (wrong
password, wrong OTP). The backend log has three sign-up deadlocks (EXS-4).

Notes on the environment, not the app: the shared headless Chrome changes `prefers-color-scheme` from
moment to moment (sampled `LLLLLLDDDDLDDDDD` over 8 s on an idle page), so screenshots switch between light
and dark. The app follows the change as designed (`followSystemTheme`). Playwright locator clicks
sometimes hung at "performing click action" on this shared browser; DOM clicks were used instead.

---

### EXS-1: Edit habit dialog prints the word "null" twice in the history panel
- Severity: Medium
- Where: `scripts/app.js`, the habit history `paint()` (the panel with "Last 30 days / All time / Best streak"), Edit habit dialog, both viewports
- Repro / evidence: Habits, then tap any habit name. Under the heatmap, and again under the "Forgot to tick?" hint, the text `null` appears. It shows on every habit that has no open day popover and no recent notes, which is most of them. `docs/evidence/audit-explore-shell/EXS-1-habit-history-null.jpg`. DOM check: a text node `"null"` inside `.gb-hh`.
- Cause: `panel.replaceChildren(..., openState ? dayPopover(...) : null, ..., notes.length ? h('ul', ...) : null)`. The DOM's `replaceChildren` turns `null` into the text "null"; only `h()` drops nulls.
- Fix: filter the arguments, e.g. `panel.replaceChildren(...[stats, grid, pop, legend, hint, notesList].filter(Boolean))`, in `scripts/app.js` habit history `paint()`. Grep the file for other `replaceChildren(` calls that take a `cond ? x : null` argument.

### EXS-2: "Keep read notifications for" shows "[object Object]" and cannot be changed
- Severity: Medium
- Where: `scripts/app.js:keepReadPicker`, Settings, Alerts tab, both viewports
- Repro / evidence: Settings, Alerts, scroll to "Keep read notifications for". The row says `[object Object]` and has no control. `docs/evidence/audit-explore-shell/EXS-2-keep-read-object-object.jpg`.
- Cause: `segmented()` returns `{ node, get }`. Every other caller uses `.node`; `keepReadPicker()` returns the whole object, and `h()` writes it out as a string.
- Fix: `return segmented(...).node;` in `keepReadPicker` (`scripts/app.js`).

### EXS-3: A reload never refreshes the account, so changes made on another device do not arrive
- Severity: Medium
- Where: `scripts/app.js` boot / `loadData` (no `/api/auth/me` call); `refreshCurrentUser` runs only after a task or habit toggle
- Repro / evidence: signed in on device A, change the display name through `PUT /api/auth/profile` (what device B's Settings does). Reload A twice: the header still says "Asha", the old name (script `t27.mjs`: "A after 2nd reload Still up, Asha"). No `/api/auth/me` request is made on reload. The same path carries `timezone`, `features` and `uiPrefs` (theme, text size, time format, working week, nav layout), so a timezone or feature change on the phone does not reach the laptop until a check-off or a fresh sign-in. A stale timezone also moves the account's "today".
- Cause: boot trusts the cached `gb.session`. `hydrateUiPrefs` runs only from `syncUserSession`, which boot does not call.
- Fix: call `refreshCurrentUser()` once at boot after the first paint (not awaited), in `scripts/app.js` where `loadData` starts for a signed-in user. It already re-arms the timezone offer and re-applies prefs.

### EXS-4: Concurrent sign-ups deadlock and return 500
- Severity: Medium
- Where: `backend/.../user/AuthService.java:signup` and `issueVerificationOtp`
- Repro / evidence: backend log (`scratchpad/backend.log`) lines 3174, 4812 and 7023: `CannotAcquireLockException ... Deadlock found when trying to get lock ... insert into email_verification_tokens`, stack through `AuthController.signup(AuthController.java:36)`, `GlobalExceptionHandler: Unhandled exception`. It happened three times during one hour while several agents were seeding accounts in parallel. The user who hits it gets a 500 on "Create account".
- Cause: `issueVerificationOtp` runs `verifyTokens.deleteAllForUser(id)` before the insert. For a user who has just been created there are no rows, so InnoDB (REPEATABLE READ) takes a gap lock on the `user_id` index. Two sign-ups whose gaps overlap then block each other's inserts. The OTP mail is also sent inside the same transaction, which keeps the locks held longer.
- Fix: skip the delete for a new user (pass a flag from `signup`, or delete only when `existsByUserId`), or delete by primary key after a plain select; send the mail after commit (`TransactionSynchronization.afterCommit`). Add a retry on `CannotAcquireLockException` as a backstop. Files: `AuthService.java`, the `EmailVerificationToken` repository.

### EXS-5: Command box "remind me at 9pm" after 9pm promises "today", then fails with two error toasts
- Severity: Medium
- Where: `backend/.../quickadd/QuickAddFallback.java:reminder`; quick add, "Log it"
- Repro / evidence: at 23:45, Quick add, type `remind me at 9pm to call mom`, Log it. The preview says "Got it! I'll remind you at 9pm today to call mom. Reminder: call mom, Today, 9:00 pm" (`cmd-4.jpg`). "Log them" then shows "That time has already passed — pick a later one." and "None of those could be logged." Nothing is saved.
- Cause: when no day word is given, `date` stays `today` even if the time is earlier than `now`. (The AI path is down locally, so this is the fallback. Check the model prompt for the same rule.)
- Fix: in `QuickAddFallback.reminder`, after the time is resolved, when no DAY or IN_TIME matched and `date.equals(today) && time.isBefore(now)`, set `date = today.plusDays(1)`. Add a case to its test.

### EXS-6: The timezone offer opens on top of a dialog the user already opened
- Severity: Low
- Where: `scripts/app.js:syncDeviceTimezone` / `offerDeviceTimezone`
- Repro / evidence: account zone UTC, browser Asia/Calcutta. Open Quick add within the first seconds after boot: "Switch to Asia/Calcutta?" appears over it, and both dialogs show at once (`panel-quickadd-desktop.jpg`). The first Escape closes the top one only.
- Cause: a fixed `setTimeout(offerDeviceTimezone, 1500)` that does not check for an open overlay. The offer is also built from the cached session; if `/api/auth/me` has not come back within 1.5 s, it can offer a switch the server already has (seen with a stale session: "your account on UTC" while the server said Asia/Calcutta).
- Fix: in `offerDeviceTimezone`, if `document.querySelector('.gb-modal-overlay.is-open')` exists, re-arm the timer instead of opening (and do not write `tzAsked`). Together with EXS-3, run it after the boot `/me` refresh.

### EXS-7: Fitness x Sleep card counts paused habits in "Habits today"
- Severity: Low
- Where: `scripts/dashboard.js:HabitSleepInsightCard`, Habits screen
- Repro / evidence: pause one of three habits, with one done. The header says "Your habits 1/2"; the card says "1/3 Habits today" (`habit-paused.jpg`).
- Cause: `allHabits = habits || []`, with no filter on `active` or due today. `fitnessHabits` is not filtered either.
- Fix: filter both with `hab.active !== false` and the same due-today rule the header uses (`habitDueToday` in app.js, or the `dueToday` field).

### EXS-8: Score ring keeps the old number after Habits is switched off
- Severity: Low
- Where: `scripts/app.js:score()` (prefers `state.score`), the feature toggle in Settings, Layout
- Repro / evidence: two habits done, no tasks done: ring 50%. Switch Habits off and press Done: the ring still says 50% next to "0/3 tasks", while `/api/score/today` returns 0 (`home-habits-feature-off.jpg`, `t36.mjs`). A reload shows 0%.
- Cause: the feature toggle does not refresh the server score, and `score()` returns the cached `state.score` whenever it is above 0.
- Fix: call `refreshScoreLater()` from the feature-toggle handler in `scripts/app.js`.

### EXS-9: Un-ticking a habit keeps its best streak and its XP
- Severity: Low
- Where: `backend/.../habit/HabitService.java` (check-in), Edit habit stats
- Repro / evidence: a new habit, tick it, then un-tick it. The server returns `streak: 0, longestStreak: 1`, and the Edit dialog's "Best streak" stays 1. XP went from 20 to 30 and stays 30 after the un-tick (`t19.mjs`: "after check 30 after uncheck 30"). The XP is granted once per day, so it cannot be farmed, but a mistaken tap leaves a permanent record.
- Cause: `longestStreak` only ever grows (by design: "The server's longest only grows"), and the XP grant is not reversed on un-tick.
- Fix: on un-tick of today, recompute `longestStreak` from history when the run that just ended was the record, and reverse today's habit XP if it was granted by that check-in. If this is intended, say so in the Edit dialog ("Best streak includes today's tick").

### EXS-10: Command box preview talks as if it is already done
- Severity: Low
- Where: quick add preview ("Log these?"), copy from `/api/quick-add`
- Repro / evidence: the preview, shown before "Log them", says "Logged ₹200 expense for lunch", "Logged 500 ml of water!", "Great job! Read 20 pages habit logged ✓", and "Got it! I'll remind you…" (`cmd-2.jpg`, `cmd-3.jpg`, `cmd-8.jpg`). Cancel then saves nothing, which contradicts the sentence above it.
- Fix: phrase the preview in the future tense, or drop the reply line from the preview and keep the item list ("Expense ₹200, lunch"). Also drop the check mark character. File: the reply text in `QuickAddFallback` and the model prompt, or the preview in `scripts/app.js:openAddSheet`.

### EXS-11: Sign-up shows two messages for a short password
- Severity: Low
- Where: sign-up view, password field
- Repro / evidence: password "short" and Create account: "Password must be at least 8 characters." and "Too short — 8 characters minimum." show together.
- Fix: show only the strength meter's line, or only the submit error, in the auth view in `scripts/app.js`.

### EXS-12: Bell filter "System" chip is cut off with no hint that the row scrolls
- Severity: Low
- Where: bell panel filter row, both viewports
- Repro / evidence: the row is 358 px wide (352 px on the phone) with 432 px of chips. "System" sits 60 to 66 px past the edge, with no fade and no visible scrollbar (`panel-bell-desktop.jpg`, `empty-bell-mobile.jpg`).
- Fix: wrap the chips (`flex-wrap: wrap`) or add an edge fade mask on the scroller, in `styles/app.css`.

### EXS-13: The first visit shows two setups with different step counts
- Severity: Low
- Where: Home onboarding card and the first-run modal
- Repro / evidence: right after verifying the email, the modal says "STEP 1 OF 3" while the card behind it says "Set up in 4 quick steps" (`firstrun-step0.jpg`). The first modal step asks the user to confirm a timezone that already matches ("They match.").
- Fix: hide the Home card until `setupDone` is set, and skip the timezone step when the device and account zones already match (`scripts/app.js:openFirstRunSetup`).

### EXS-14: Once a theme is picked there is no way back to following the system
- Severity: Low
- Where: Settings, Display, Theme (`scripts/app.js:toggleTheme`, `pickedTheme`)
- Repro / evidence: the picker has only Light and Dark. Picking one writes `gb.theme` and `ui_prefs.theme`, and from then on `followSystemTheme` ignores the OS. Before any pick, the option that matches the OS shows as selected, and tapping it does nothing (no pick is stored), so the control cannot say whether the app is following the OS.
- Fix: add a "System" option that clears `gb.theme` and `ui_prefs.theme`, and select it when neither is set.

### EXS-15: Money tags and currency preferences sit under Settings, Layout
- Severity: Low
- Where: Settings, Layout tab (bottom)
- Repro / evidence: after Features, Home cards and Bottom bar, the Layout tab ends with "MONEY: Your tags, Preferences, Other currencies" (`settings-layout-desktop.jpg`). Someone looking for currency settings would not look under Layout.
- Fix: move the Money block to the Money screen's own settings, or to a "Money" section under Profile.
