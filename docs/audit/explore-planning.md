# Explore: Calendar, Notes, Goals (prefix EXP)

Explored 2026-10-11/12 with Playwright attached over CDP (http://localhost:9591) to Vite :5591 / backend :8591,
at 1280x800 and 390x844 (isMobile), on a seeded account (`e2e.1791739879709.3396@example.com`) and an `--empty`
one. Scripts were scratchpad one-offs (`h.mjs` helper + `c*.mjs` calendar, `n*.mjs` notes, `g*.mjs` goals).
Screenshots: `docs/evidence/audit-explore-planning/`.

## Completion by feature

| Feature | Measured | Evidence |
|---|---|---|
| Calendar: create one-off + every repeat (Once, Daily, Mon-Fri, Weekly, Monthly, Yearly), notes, time | 100% | all 6 stored with the right `repeat`; rows and grid counts right; persisted across reload (`cal-after-create.jpg`) |
| Calendar: richer rule (every N, weekday chips, nth weekday, end after N) | 100% | "Every 2 weeks on Mon, Fri · 6 times" stored `iv=2 days=MO,FR count=6`, absent Oct 19, present Oct 26/30; "3rd Friday" stored `nth=3`, on Nov 20 not Nov 16 (`cal-nov-month.jpg`) |
| Calendar: scoped edit this / future / all | 100% | this: series `skip=[10-13]` + new one-off 20:00; future: series `until=10-14` + new series from 10-15 at 20:30; all: renamed in place; all survive reload (`cal-edit-dialog.jpg`) |
| Calendar: scoped delete (this, before, all) + one-off delete confirm | 90% | all work; "Only past days" is offered on the first occurrence where it does nothing (EXP-4); no Undo (EXP-5) (`cal-delete-scope-dialog.jpg`, `cal-oneoff-delete.jpg`) |
| Calendar: done per occurrence | 85% | `doneDates=[today]`, persists after reload; the tick mark draws outside its circle (EXP-3) (`cal-done-check-zoom.png`) |
| Calendar: snooze (bell) + cancel (row) | 100% | POST `/snooze` 200, notification marked read, row "Snoozed till 23:44", DELETE `/snooze` clears it (`cal-bell-snooze.jpg`, `cal-row-snoozed.jpg`) |
| Calendar: .ics export | 100% | Settings > Reminders > Export downloads 15 VEVENTs; RRULE for each rule incl. `INTERVAL=2;COUNT=6`, `BYDAY=3FR`, `UNTIL`, EXDATE for skips; weekday series start on a Monday |
| Calendar: past day read-only, "until" before start | 100% | no form on Oct 10; inline "This is before the reminder starts on Fri, October 16." |
| Calendar: phone width | 100% | no horizontal overflow; edit dialog scrolls inside (`scrollHeight 1219 > 802`, overflow auto) (`calendar-seeded-390.jpg`, `cal-edit-dialog-390.jpg`) |
| Notes: composer + draft autosave | 75% | draft PUT after typing, restored after reload, dropped on save (204); caret resets to the start on any re-render, scrambling text (EXP-2) |
| Notes: rich text (bold, checklist), colour | 100% | stored `<ul data-checklist><li><b>…</b></li></ul>`, `color: sun` |
| Notes: edit sheet autosave + restore, labels | 100% | `{id}/draft` holds body + `labels:["travel"]`, restored on reopen with "Picked up your unsaved changes."; dropped on save |
| Notes: photos | 100% | toolbar picker -> JPEG data URL with alt "beach sunset", `photoCount 1`, cover 7.6 kB, cover on the card after reload, full photo in the sheet (`notes-photo-card.jpg`) |
| Notes: archive / unarchive / undo | 100% | Undo toast restores; Archived (1) view; Unarchive returns to Notes with "Back in your notes." |
| Notes: delete / undo / trash / restore / delete forever | 100% | confirm "Delete this note?", Undo toast, Trash shows days left, Restore, Delete forever with confirm (`notes-trash.jpg`) |
| Notes: search (title, body, photo alt), pin, sort | 100% | "beach" highlights `<mark>`, "sunset" finds the photo's alt; pin moves to top and persists; Title sort |
| Notes: edit conflict (409) | 100% | PATCH from elsewhere -> "This note changed elsewhere" with the three choices (`notes-conflict.jpg`) |
| Goals: create (horizon, why, date, track daily, linked habit), validation | 100% | stored with `durationDays 30`, `linkedHabitIds`; empty title and 5000 days refused (toast only, EXP-8) |
| Goals: milestones add / tick / rename / due / move / delete, reload | 100% | progress blob updated each time, "Overdue 5 Oct", "Next" tag, survives reload (`goals-milestones.jpg`) |
| Goals: day tracker, log action, linked task | 100% | Log a day -> "Logged today · Undo" -> back to 0; action stored; Add a task pre-picks the goal, tick counts "Tasks: 1/1" |
| Goals: edit goal | 0% | every save fails with "Cannot access 'goal' before initialization", no request sent (EXP-1) (`goals-edit-save-error.jpg`) |
| Goals: mark done, Completed section, delete | 95% | "Completed (1)", "Reopen", delete confirm names what happens to tasks; tasks unlinked on delete |
| Goals / Notes: empty account, phone width | 100% | empty states present, no overflow (`goals-empty-390.jpg`, `notes-empty-390.jpg`) |

No console error or failed request was seen on any flow other than the deliberate 409 of the conflict test.

## Findings

### EXP-1: Editing a goal always fails: "Cannot access 'goal' before initialization"
- Severity: High
- Where: scripts/goals.js:openGoalForm (onPrimary), Goals screen, both viewports
- Repro / evidence: Goals > pencil "Edit goal: Learn Spanish" > Save changes (with or without a change). Toast
  "Cannot access 'goal' before initialization", dialog stays open, no PUT is sent, title/horizon/date/why/linked
  habits never change. Clearing the target date also fails the same way. `goals-edit-save-error.jpg`.
- Cause: inside the `onPrimary` async function, the create branch declares `const goal = await onCreateGoal(...)`.
  That `const` is scoped to the whole function body, so it shadows `openGoalForm`'s `goal` parameter for the
  editing branch too, and `onUpdateGoal(goal.id, ...)` reads it in its temporal dead zone. Introduced in 0229995
  ("app-wide compact copy pass").
- Fix: rename the create branch's binding (`const created = await onCreateGoal(...)`, then `created.id`) in
  scripts/goals.js. Worth a check that fails if it comes back (an e2e that edits a goal, or lint `no-shadow`).

### EXP-2: Notes composer caret jumps to the start on any re-render, so typing lands out of order
- Severity: Medium
- Where: scripts/notes.js:ScreenNotes (composer, `composerDraft`), Notes, both viewports
- Repro / evidence: open the composer, type "alpha", switch the OS/browser colour scheme (or anything else that
  calls app.js `render()`), keep typing " beta": the body reads " betaalpha". Reproduced deterministically with
  `page.emulateMedia({colorScheme})` mid-typing (`notes-composer-caret-reset.jpg`). Under repeated renders a
  typed "Draft body text" was saved as "xtt body terafD". The calendar's add form, put through the same flip,
  kept "Water plants" intact.
- Cause: `followSystemTheme` (app.js) calls `render()`, which rebuilds Notes through `lazyScreen`; ScreenNotes
  rebuilds the composer from `composerDraft` (title, html, colour) and refetches the list and draft, but focus
  stays in the new editor with the caret at offset 0. Other `render()` callers (refreshDayIfStale, socket-driven
  repaints) hit the same path.
- Fix: keep the composer node across renders the way calendar.js caches its form (`buildForm`), or record the
  caret in `composerDraft` and, when the editor had focus, restore focus with the caret at the end on rebuild
  (scripts/notes.js).

### EXP-3: Reminder done tick draws its check mark outside the circle
- Severity: Medium
- Where: styles/app.css `.gb-rem-check svg`; Calendar reminder rows (and anywhere ReminderRow shows), both viewports
- Repro / evidence: tick any reminder. The circle fills but the check sits at its bottom edge, clipped: button box
  880,297 32x32, icon span at 889,323 14x14 (`cal-done-check-zoom.png`, `cal-bell-snooze.jpg`).
- Cause: `Icon()` returns a `<span>` wrapping the svg. The rule puts `grid-area: 1 / 1` on the `svg`, but the
  grid item is the span, which auto-places into a second implicit row under the `::before` circle.
- Fix: target the grid child: `.gb-rem-check > * { grid-area: 1 / 1; position: relative; }` in styles/app.css.

### EXP-4: "Only past days" is offered on a series' first occurrence and reports a delete that did nothing
- Severity: Low
- Where: scripts/calendar.js:openDeleteDialog
- Repro / evidence: on the day a daily reminder starts, Delete > "Only past days — Delete everything before Sun,
  October 11". Server answers 204 and only sets `from` to that same day; the toast says "Reminder deleted." and
  nothing changed. "This & all future" on that day is the same as "Delete whole series".
- Cause: the four scopes are listed unconditionally.
- Fix: when `occKey` is the first live day (max of `rem.date` and `rem.from`, as `ReminderService.nothingBefore`
  computes), drop "Only past days" and let "This & all future" read as the whole series (scripts/calendar.js).

### EXP-5: Deleting a reminder or a goal has no Undo, unlike Notes
- Severity: Low
- Where: app.js `deleteReminder`, `confirmDelete` for goals
- Repro / evidence: one-off reminder: confirm, then gone, toast "Reminder deleted." with no action. Recurring:
  the scope dialog deletes on one tap. Goal: confirm, toast "Deleted.". Notes offer Undo on both archive and delete.
- Cause: no restore path for reminders/goals.
- Fix: for the whole-series and one-off cases the row is already removed optimistically; holding the DELETE behind
  `toast.action('Reminder deleted.', 'Undo', ...)` for a few seconds would match Notes (scripts/app.js).

### EXP-6: The silent tone has two names
- Severity: Low
- Where: scripts/calendar.js `toneSelect('Silent — no alert')` (add form) vs `toneSelect('Silent in the app')` (openEditDialog)
- Repro / evidence: Tone list in New reminder shows "Silent — no alert"; the same option in Edit reminder shows
  "Silent in the app".
- Fix: one label in both (calendar.js), matching Settings > Alerts (app.js uses "Silent — no alert").

### EXP-7: "That was the last task" offers "Mark goal done" while the goal's milestones and tracker are open
- Severity: Low
- Where: scripts/goal-tasks.js:goalFinishedBy, app.js suggestGoalDone
- Repro / evidence: goal with 1/2 milestones and a 0/30 day tracker; tick its only linked task: toast
  "That was the last task for “Learn Spanish”. Mark goal done". The card itself correctly does not say
  "Everything here is done".
- Cause: `goalFinishedBy` checks linked tasks only.
- Fix: also require every milestone done and the tracker full (the same test the card uses), in goal-tasks.js.

### EXP-8: Goal form errors appear only as a toast, not at the field
- Severity: Low
- Where: scripts/goals.js:openGoalForm
- Repro / evidence: Save goal with an empty title -> toast "Give the goal a name first."; Track daily 5000 ->
  toast "Track daily takes a whole number of days, 1 to 1000." Nothing is marked in the dialog. The calendar's
  "until" check writes into `.gb-field-error` under the input instead.
- Fix: write the message into a `.gb-field-error` under the field as calendar.js does.

### EXP-9: A completed goal keeps every editing control
- Severity: Low
- Where: scripts/goals.js:GoalRow, Completed section
- Repro / evidence: after Mark done, the card still offers "Add a milestone…", milestone pencils, "Add a task",
  "Log action" and "Track days" next to "Reopen" (`goals-completed.jpg`). Adding work to a finished goal is
  possible but reads oddly next to the "Complete" chip.
- Fix: hide the add/log controls on a completed goal and leave Reopen, or confirm it is intended.

## Notes on the environment (not app bugs)

- The shared CDP Chrome flips `prefers-color-scheme` and backgrounds tabs as other sessions work. That made
  Playwright clicks stall on "waiting for element to be stable" (no animation frames) and caused theme flips that
  re-rendered the app mid-test; it is how EXP-2 surfaced. Clicks fell back to `element.click()` after 6 s.
- The seeded account is on UTC, so the timezone offer ("Switch to Asia/Calcutta?") opens on first load; the
  empty account opens first-run setup. Both were dismissed before each flow.
