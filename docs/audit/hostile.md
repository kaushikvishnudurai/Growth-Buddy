# Hostile testing (prefix HOS)

Integrated build at http://localhost:5588 (Vite dev, proxied to backend :8590, DB gb_ov1011), 2026-10-12.
Tester did not build the app. Playwright over CDP against an own headless Chrome (:9584, own profile, killed
at the end). Every write was checked against the API with the account's own token; two findings were also
checked in MySQL. Scripts: `/private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/hos/`
(`lib.mjs` has `netCtl`: CDP `Fetch` on `/api/` + `/ws/` for latency, per-request delay and
`Fetch.failRequest(InternetDisconnected)` offline, with `navigator.onLine` and the events driven from the
test). Accounts: `accA..accG`, `accE` (`--empty`), `accBig` (500 tasks, 300 notes, 2000 expenses added by API).
Evidence: `docs/evidence/hostile/`.

## What held (verified, no finding)

- **HTML / script in every text field** (task title + notes, note title + body incl. `javascript:` links,
  `<iframe>`, `<svg onload>`, pasted `text/html` with `position:fixed`, reminder text, goal title +
  description, circle name + goal, circle post + comment, display name, Buddy chat, header search). No
  dialog fired, no `img[src=x]`, script, iframe or `javascript:` href reached the DOM on any of 15 screens,
  the note editor, the search palette, the bell or the account panel. The server stores the raw text; the
  client escapes or sanitises it everywhere it is shown (`xss-note-editor.jpg`, `xss-circle.jpg`). The
  .ics export escapes CR/LF, `;` and `,`, and folds long lines (a reminder text with injected
  `END:VEVENT ... BEGIN:VEVENT` stays one SUMMARY).
- **Length limits**: task 255, note title 200, reminder 255, habit 120, display name 120, post 2000,
  comment 500 are enforced by `maxlength` and by the server (400 with a plain message). A 5 MB note body
  gets "That note is too big to save". 10,000 RTL + emoji characters typed into a note saved intact
  (11,007 chars).
- **Long unbroken strings** (255 x "W" task, reminder, goal, 3,000-char note word, 2,000-char post, 80-char
  display name): no horizontal overflow on any screen at 390 px.
- **Money amounts**: -50, 0, 1e309, `abc`, blanks, 99999999999, 10000001 are refused with field errors;
  9,999,999.99 is accepted; a future date gets "Pick a day up to today".
- **Triple clicks under 2 s latency** on Add habit, Save goal, Save note, Add reminder, Create circle: one
  row each on the server. Rapid toggles (3 and 5 taps, 0 / 400 / 1500 ms latency) on a task and a habit:
  one request per burst, UI and server agree, also after a reload.
- **Flapping connection** (offline/online every 200 to 650 ms, 700 ms latency): 10 tasks, 6 expenses and
  4 notes created through it all landed exactly once, no duplicates, after reconnect and after a reload.
- **In-flight reload**: a task and a one-off reminder whose POST was still held when the page reloaded
  were replayed by the outbox after the reload (OFF-1 is fixed for these). Habit and goal create keep the
  dialog open until the server answers, so a reload there loses nothing the UI had confirmed.
- **Sign-out mid-save**: an online save in flight completes before `POST /api/auth/logout`; an offline
  queued write gets the "1 change not synced yet" prompt (`signout-offline-prompt.jpg`).
- **Back/forward spam** (9 back, 40 alternating, 15 forward) lands on the right screen with the right nav
  item, no stray overlay, no console error; Back with a dialog open closes the dialog.
- **Huge data** (`accBig`, desktop and 390 px): Home, Money, Notes, Calendar, Report, Goals settle in
  under 200 ms after navigation with no long task; Notes renders all 301 cards (4,845 nodes) and scrolls
  20,000 px at 17 to 19 ms per frame; note search filters 301 cards to 13; Money's Spending tab with 2,000
  expenses opens in about 1.5 s.
- **Empty account** on all 15 screens, desktop and phone: no `NaN` / `undefined` / `null` / `Invalid Date`,
  no overflow, no console error, no 4xx/5xx.
- **Slow network** (CDP 3G-like throttle + 2 s on every API call): Home is usable after about 4 s and fully
  populated at about 12 s; a task added during it reached the server; no false offline state.

## Findings

### HOS-1: A task due after January 2038 (or before 1970) cannot be saved, and the error says it was "already saved"
- Severity: High
- Where: Home > Tasks > + Add / Edit task (any viewport); `tasks.due_at`; `GlobalExceptionHandler.handleConflict`
- Repro / evidence: New task, title "Due in 2100", Due `01/01/2100 09:00`, Add task. `POST /api/tasks` 409,
  toast "That was already saved. Refresh and try again.", dialog stays open, nothing saved
  (`task-due-2100.jpg`). Same for 2039-03-01 and for an edit to 2045 (`PUT /api/tasks/{id}` 409). By API:
  `dueAt` 1970-01-01, 1900-01-01, 2100-12-31, 9999-12-31 all 409. Backend log:
  `Data truncation: Incorrect datetime value: '2100-12-31 00:00:00' for column 'due_at'`. The datetime
  input has no `min`/`max`, so nothing stops the date; Refresh and retry can never succeed.
- Cause: `due_at` is MySQL `TIMESTAMP` (range 1970-01-01 to 2038-01-19 UTC; TiDB is the same). Any
  `DataIntegrityViolationException`, including SQLState 22001 (data truncation), is mapped to 409 with the
  duplicate-tap wording.
- Fix: make user-chosen instants `DATETIME(6)` (`tasks.due_at`, `task_completion_history.due_at`) in
  `tableCreationQueries.sql` plus an `ALTER ... MODIFY` in `migrations.sql`. In
  `GlobalExceptionHandler.handleConflict`, map SQLState `22001` / errors 1292 and 1406 to 400 "That value
  is out of range" instead of the conflict text. Optionally a `max` on the due input in `taskForm`
  (app.js).

### HOS-2: Goal milestones added on two devices or tabs: the second save silently erases the first
- Severity: High
- Where: Goals > milestone field (desktop and phone); app.js `updateGoalProgress`; `PUT /api/goals/{id}/progress`
- Repro / evidence: `tabs-goal.mjs`. Account open in tab 1 and tab 2 on Goals. Tab 1 adds milestone "Tab one
  milestone" (PUT 200), then tab 2 adds "Tab two milestone" (PUT 200). Server `progress.milestones` =
  `[{"title":"Tab two milestone"}]`; after a reload tab 1 shows only tab two's milestone
  (`tabs-goal-milestone-lost.jpg`). No conflict, no toast. Same for ticks, day-tracker and anything else in
  the blob.
- Cause: each save PUTs the whole progress blob built from that tab's copy; the server stores it as given
  with no version check (Money has ETag/If-Match, goals do not).
- Fix: send the goal's `updatedAt` (or an ETag) as `If-Match` from `updateGoalProgress`, have
  `GoalService.saveProgress` refuse a stale one with 409, and on 409 refetch the goal and re-apply the
  patch (the patch is already a small object). Server-side merge of milestones by id is the alternative.

### HOS-3: Two quick milestone edits on a slow link land out of order and the older one wins
- Severity: Medium
- Where: Goals (one tab); app.js `updateGoalProgress`
- Repro / evidence: `race-goal.mjs`. The first `PUT /progress` is delayed 3 s, the second is not. Add
  milestone "Race one", 300 ms later "Race two". UI shows both; server keeps `["Race one"]` (the first PUT
  arrived last and overwrote the second). The next reload drops "Race two" with no message.
- Cause: the PUTs are not serialised; `goalProgressSeq` only decides which failure to roll back.
- Fix: chain the PUTs per goal the way `moneySaveQueue` does (app.js), or send only the newest blob once the
  previous request settles. The HOS-2 version check would also catch it.

### HOS-4: Double-tap on a reminder's delete deletes the next reminder too, and Undo brings back only one
- Severity: High
- Where: Calendar > day list, trash button (`calendar.js` `handleDelete`, app.js `deleteReminder`); desktop and 390 px
- Repro / evidence: `del2.mjs` (phone) and `del.mjs` (desktop). Three one-off reminders today "DBL a/b/c".
  Double-click the trash on "DBL a": two `DELETE /api/reminders/...?scope=all` 204, one toast "Reminder
  deleted. Undo". Undo re-creates one (POST 201); server afterwards: "DBL b, DBL c" plus the seed ones,
  "DBL a" is gone for good (`del-rem-dblclick-phone.jpg`). Three clicks 120 ms apart on the desktop
  deleted three reminders.
- Cause: a future one-off deletes on one tap; `deleteReminder` removes the row at once (`whole` scope), the
  next row slides under the pointer and the second tap deletes it. The Undo toast only holds the last
  delete.
- Fix: in `calendar.js` ignore delete taps for about 500 ms after a delete in the same list (or keep the
  removed row's slot, collapsed, until the toast closes); in app.js make the Undo cover every delete made
  while it is showing (a stack, not one slot).

### HOS-5: Two taps on a Home task's check box 250 ms apart also complete the next task
- Severity: Medium
- Where: Home > Tasks (`gb-check`), desktop
- Repro / evidence: `del.mjs`. Three clicks at the same point 250 ms apart on "Mark as done: Book the
  dentist": `PATCH .../toggle` for Book the dentist and for Plan this week; server
  `Plan this week:true, Book the dentist:true`. The ticked row moved to the bottom and the next task took
  its place under the pointer. A Playwright `dblclick` (two clicks within a few ms) did not trigger it, so
  it needs a human-speed double tap.
- Cause: a done task re-sorts to the end on the optimistic render, immediately.
- Fix: keep a just-ticked row in place for a short delay (or until the pointer leaves the list) before
  re-sorting, in `dashboard.js`'s task list; same idea for the habit list, which re-sorts too.

### HOS-6: A stale tab or a resumed phone app un-does a tick when the user taps it again
- Severity: Medium
- Where: Home tasks and habits; `PATCH /api/tasks/{id}/toggle`, `PATCH /api/habits/{id}/toggle`; app.js `visibilitychange` handler
- Repro / evidence: `tabs-toggle.mjs`. Tab 1 ticks "Plan this week" and the habit "Read 20 pages" (server
  true/true). Tab 2, opened before, still shows both unticked; the user taps "Mark as done" on both. Server
  now `done=false`, `doneToday=false`; tab 2 shows them unticked again (`tabs-toggle-tab2.jpg`). The user
  did the task, tapped done twice, and it is recorded as not done; a habit untick can cost a streak.
- Cause: the toggle endpoints flip the stored value instead of setting the one the user saw, and the
  `visibilitychange` handler (app.js) refreshes notifications, water and food but not tasks or habits, so
  a backgrounded phone resumes with stale ticks.
- Fix: send the intended state (`PATCH /toggle` with `{done:true}`; `TaskService.toggle` and
  `HabitService.toggleToday` set it, and an already-done task answers 200 unchanged); the outbox replay
  then becomes safe too. Also refetch `/api/tasks` and `/api/habits` in the `visibilitychange` handler when
  the tab was hidden for more than a minute.

### HOS-7: An expense dated before 1900 is saved and counted in the balance but can never be seen or deleted
- Severity: Medium
- Where: Money > Add expense, Date field; `MoneyLedger.page`
- Repro / evidence: `money3.mjs`. Add expense 77, Date `0001-01-01` (one wrong keystroke in the year):
  "Expense added.", `POST /api/money/tx` 200. MySQL `money_transactions` has it (`occurred_on 0001-01-01`);
  `GET /api/money` (400-day window) and `GET /api/money/tx?before=1900-01-01` both return no expenses, so
  no screen lists it. Cash balance from `GET /api/money` = -10000166.34, which includes it.
- Cause: the date input has `max` (today) but no `min`; `MoneyLedger.page` floors its range at
  `LocalDate.of(1900, 1, 1)` when there are fewer rows than the page limit, so older rows are never paged.
- Fix: a `min` (for example 2000-01-01) on the expense, income and transfer date inputs (money.js) plus the
  same bound in `MoneyLedger.toRow` (400 "Pick a date after 2000"); drop the 1900 floor in `page` (use
  `LocalDate.MIN`-safe `occurred_on < ?` with no lower bound when `cut` is empty).

### HOS-8: A task deleted elsewhere cannot be cleared from a stale screen: "wandered off for a snack. Try again."
- Severity: Low
- Where: Home tasks (toggle, edit); `ApiException.notFound`; desktop
- Repro / evidence: `tabs-del.mjs`. Delete "Renew passport" from another session, then tick or edit it in
  the open tab: `PATCH /toggle` 404 and `PUT` 404, toast "Oops, Task wandered off for a snack. Try again.",
  the row stays, retry repeats the 404 (`tabs-stale-toggle-deleted.jpg`). The edit dialog stays open.
- Cause: a 404 is handled like any other failure (roll back and toast) instead of meaning "gone".
- Fix: in app.js `toggleTask` / the task save path, on 404 remove the task from `state.tasks`, close the
  dialog and toast "That task was deleted on another device." Reword `ApiException.notFound` so it does
  not suggest a retry.

### HOS-9: Names made only of invisible or bidi-control characters are accepted and render blank or reversed
- Severity: Low
- Where: display name (`PUT /api/auth/profile`), circle name, task title, reminder text, post body; Home greeting, Circle card
- Repro / evidence: `bidi.mjs`. Display name `"‮Asha Rao"`: Home greeting reads "Still up, ahsA"
  (`bidi-home.jpg`). Circle name of two U+200B: 201, the circle card has an empty title
  (`bidi-circle.jpg`). Task title of three U+200B and a post of two U+200B: 201. Blank-only names
  (`""`, `"   "`) are already refused or ignored, so only the format characters get through. Other members
  would see a reversed name in member lists, and an unclosed U+202E can reverse the text after it on the
  same line.
- Cause: `@NotBlank` and the trims only treat whitespace as empty; user strings are rendered without bidi
  isolation.
- Fix: one server helper that strips `\p{Cf}` (zero-width and bidi controls) before the blank check, used by
  the profile, circle, task, reminder and post DTOs; in `gb-kit.js` `h()` call sites that print other
  users' names, wrap them in `<bdi>` (or `dir="auto"` with `unicode-bidi: isolate`).

### HOS-10: Task notes over 64 KB fail with the same "already saved" 409
- Severity: Low
- Where: `CreateTaskRequest.notes` / `UpdateTaskRequest.notes` (TaskDtos.java); `tasks.notes TEXT`
- Repro / evidence: `api1.mjs`: `POST /api/tasks {"title":"bignotes","notes":<70,000 chars>}` 409 "That was
  already saved. Refresh and try again."; log `Data too long for column 'notes'`. API only (the task form
  has no notes field today), but any client that adds one gets the misleading message.
- Cause: no `@Size` on `notes`; same handler mapping as HOS-1.
- Fix: `@Size(max = 10000)` on both `notes` fields (TaskDtos.java); the HOS-1 handler change covers the rest.

## Counts

High 3 (HOS-1, HOS-2, HOS-4), Medium 4 (HOS-3, HOS-5, HOS-6, HOS-7), Low 3 (HOS-8, HOS-9, HOS-10).
