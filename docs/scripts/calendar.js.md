# scripts/calendar.js — Calendar screen

Exports: `ScreenCalendar`, `CalendarToolbar`, `MonthGrid`, `ReminderPanel`,
`resetCalendarForm` (confirm the exact list in the export block).

`prefillCalendarReminder(text, opts?)` hands another screen's text to the cached add form (held until
the form exists, since the caller switches screens first); `opts` `{time, repeat}` also presets the
time and repeat — Report's "Set a bedtime reminder" sends a daily one.

Shows reminders (with color tags + recurrence), tasks due, completed tasks, goal action dates,
and per-day food. app.js drives month navigation and does
**in-place repaints** (`rerenderCalendarMonthInPlace`, `repaintCalendarGrid`,
`rerenderCalendarToolbarIfActive`, `updateCalendarDaySelection`) instead of a full render.

## Data

| Const | Value |
|---|---|
| `TAGS` / `TAG_ORDER` (32/67) | `work`, `personal`, `health`, `urgent`, `other` + colors |
| `REPEATS` / `REPEAT_ORDER` (70/77) | `none`, `daily`, `weekly`, `monthly`, `yearly` |
| `MONTHS`, `DOW` (15/29) | display labels |

Day-key helpers: `pad`, `keyOf(y,m,d)`, `parseKey`, `todayKey`, `isFutureKey`, `prettyDate`,
`formatTime`, `keyFromInstant`, `prettyTaskTime`.

## Occurrence logic (the part to read before editing)

- `occursOn(rem, key)` (120) — expands recurrence client-side for display; the backend has its own
  expansion (`ReminderService`) for delivery. **Keep the two consistent.**
- `occursOn` no longer lives here — it is `scripts/recurrence.js`, shared with the Home mini
  calendar. There were three copies and the dashboard's had already drifted (no end-of-month
  clamp, so a monthly reminder anchored to the 31st vanished from Home's dots in February).
  Two remain by necessity: this module's import and `ReminderService.occursOn`, which drives
  WhatsApp delivery and can't import JS. `scripts/recurrence.test.mjs` and
  `ReminderServiceOccursOnTest` are mirrors of each other — change one, change both. Add new
  cases to `scripts/recurrence.cases.json`: both `recurrence.test.mjs` and the Java
  `SharedRecurrenceCasesTest` read it.
- Repeat options: `none`, `daily`, `weekdays`, `weekly`, `monthly`, `yearly`. The column is
  `varchar(16)`, so a new value needs no migration. **`weekdays` means the user's working week**,
  not Mon-Fri — `REPEATS.weekdays.label` is a *getter* reading `WORK_WEEKS[getWorkWeek()]`. The
  getter alone isn't enough for the segmented control: the form DOM is cached for the session, so
  its button text is a snapshot. `ReminderPanel` calls `repeatPicker.relabel()` on every render to
  re-read the getter. `REPEATS[x].phrase` exists only for the
  delete dialog's "repeats ___" sentence, where `label.toLowerCase()` would read "repeats mon-fri".
- **The richer rule** (`RuleExtras`, under the Repeat picker in the add form and the edit dialog):
  "Every N days/weeks/months/years" (`repeatInterval`; hidden for `weekdays`), weekday chips for a
  weekly reminder (`repeatDays`, "MO,WE,FR"; weekly with none picked shows the anchor's day
  picked, which means the same), "On day 14 / the 2nd Tuesday / the last Tuesday" for a monthly
  one (`repeatNth`, from `nthWeekdayOf(anchor)`; "last" is offered only when the anchor is in the
  month's last 7 days), and "End after N times" (`repeatCount`). `sync(repeat, anchorKey)` shows
  what that repeat can use (`ReminderPanel` re-syncs the cached form to the selected day);
  `get()` always answers all four in the PATCH's clear-able form (interval 1, days '', nth 0,
  count 0), which `ReminderService.normalizeRule` turns into nulls. The edit dialog sends them only
  with a `repeat` (not for scope `this`). `describeRepeat(rem)` is the row's label ("Every 2 weeks
  on Mon, Fri · 6 times"), also used by Settings → Reminders. The semantics live in
  `recurrence.js`; the cases in `recurrence.cases.json` hold both sides to them.
- **Notes + a second alert.** `notesInput` (≤1000, the column) sits under the title in both forms;
  the row shows it under the text. `secondAlertSelect` is None or a lead, with no "Default", since
  `notify_before2` has nothing to fall back on; the edit dialog sends `notifyBefore2: -1` and
  `notes: ''` to clear. Text inputs are `maxlength: 255`, the column's width (they were 120).
- **Done, per occurrence.** `ReminderRow` leads with a round checkbox (`.gb-rem-check`,
  `role=checkbox`) when `onToggleDone` is passed (app.js `toggleReminderDone`, optimistic, POST /
  DELETE `/api/reminders/{id}/done?date=`). Done is read from `rem.doneDates` for the row's
  `occKey`, so ticking today's leaves tomorrow's. A done occurrence is struck through
  (`.is-done`), isn't delivered by the server, and push.js queues no alarm for it.
- **Export.** Settings → Reminders ends with "Export calendar (.ics)" (app.js `exportRemindersIcs`,
  `GET /api/reminders/export.ics`, read through `apiFetch`'s `raw` option, then share sheet or
  download).
- `remindersOn` (149), `tasksOn` (162), `completedTasksOn` (179), `goalActionsOn` (185), `dueKey` (155).
- **"Repeat until" before the start date makes a reminder that can never fire.** `occursOn` returns
  false for every day, so it sits in the list forever advertising an end date in the past. The form
  sets `untilInput.min = selectedDate`, but `min` on a date input is only a *declared* constraint —
  nothing checks it unless the input is inside a submitting `<form>`, and this one isn't. `submit()`
  compares the two `YYYY-MM-DD` strings itself and writes the reason into `.gb-field-error` under
  the input; `ReminderService.create` rejects it server-side too.
  **Don't go back to `reportValidity()` here.** It does enforce `min` and does return false, so the
  reminder was refused correctly — but the bubble it draws needs the input focused and vanishes as
  soon as anything else takes focus, so the only thing a user saw was a button that did nothing.
- **Scoped edit mirrors scoped delete.** `openEditDialog` asks the same question the delete dialog
  does, because the row on screen is one occurrence of a series. The model has no per-occurrence
  overrides, so `this` can only mean *skip that day and leave a one-off in its place*; `future` cuts
  the series at the day before and starts a new one; `all` edits the row. The server does the split
  (`ReminderService.update`). An `all` edit answers with the same reminder, so `editReminder` in
  app.js swaps that row in place; any other answer is a brand-new reminder and the list is refetched.
  The dialog awaits the save and closes only on success — `editReminder` toasts and rethrows on
  failure, so the typed edit stays on screen.
  The dialog edits text, notify, time, **tag**, **day** (a one-off, or scope `this` — a series is
  measured from its anchor, so not for `future`/`all`), **repeat + until** (not for `this`) and tone.
  A PATCH's null means "unchanged", so clearing needs words of its own: "No time, just the day"
  sends `allDay: true`, an emptied until sends `clearUntil: true`.
  **"This & all future" from the first occurrence deletes the row.** The server compares the cut
  against the series' first live day (`ReminderService.nothingBefore`: max of anchor and `from`);
  comparing `from` alone left a row ending the day before it began (`ReminderScopedSplitTest`).
- **Each reminder can carry its own tone.** The form's Tone `<select>` sends a chime key from
  `chime.js`; an empty value means "the default from Alerts", which is stored as null so the
  reminder keeps following that setting when it changes. A `<select>` and not the segmented control
  the Alerts pane uses — six options don't fit the side panel. Picking one previews it; picking
  "Default tone" previews nothing, because this file doesn't know which tone that is. The tone is
  set at creation and changed in the edit dialog (`openEditDialog`).
- **Notify before.** `notifySelect()` is the Notify <select> in both the add form and the edit
  dialog — **above Time**, by request. `''` = follow the default (sent as null on create, **-1** on
  an edit, because a PATCH's null means "unchanged"); otherwise one of `LEAD_OPTIONS` (0, 5, 10, 15,
  30, 60, 120, 1440 minutes). The default is module state (`setDefaultLead`/`getDefaultLead`, fed
  from `ui_prefs.reminderLead` by app.js like the routine), so the Default option can name it; the
  select refills on focus because the add form is cached. Under it, a link opens Settings on the
  Reminders tab (`setReminderSettingsOpener` — app.js owns Settings). `ReminderRow` shows a
  reminder's **own** lead (never the default — that would repeat down the list) and "Snoozed till
  09:20" while one is pending. `leadLabel`/`minutesLabel` (= `ReminderPrefs.human`) are exported
  for Settings, with `REPEATS`/`REPEAT_ORDER`/`TAGS`. `notifySelect` returns a **wrapper** (`.gb-notify`), not the <select>:
  its last option, **Custom…**, opens a minutes/hours box clamped to 1440 as typed (the server's
  `MAX_LEAD`), and `setLead` reopens it for any value that isn't a preset. Exported as `NotifySelect`,
  which Settings → Reminders uses too.
- **The mic beside "New reminder"** (`setVoiceReminder`, app.js `captureReminder`) fills the whole form
  from one sentence. Order matters in `fillFromSpeech`: `formBinding.selectedDate` moves to the spoken
  day **before** the repeat is set, and the rule is reset from scratch (`rule.set`), because
  `RuleExtras` takes a weekly reminder's weekday from the selected day and keeps a picked one —
  filled the other way round, "every Monday" was stored as Saturdays. Then `onSelectDate` moves the
  calendar; the caret only returns when the day didn't change (a repaint waits while the panel has focus).
- **"+ Add your own sound…"** ends every `toneSelect` list. Its own change listener runs first and
  `stopImmediatePropagation`s, so the caller's preview never plays the `__add` entry, then calls the
  adder app.js hands in (`setCustomToneAdder` → `openCustomToneDialog`) and selects the key it
  resolves to. The tone is this reminder's; the default in Alerts is left alone.
- **Past days are read-only.** `ReminderPanel` computes `pastDate` and drops the whole form block
  for any day before today, so a reminder can only be filed on today or later. `app.js`
  `addReminder()` refuses a past `key` for every caller, and `ReminderService.create` rejects it
  server-side — with **one day of slack**, because "today" there is the user's stored timezone,
  which falls back to UTC, and a UTC server is already on tomorrow while half the world is not.

## Components

| Fn | Notes |
|---|---|
| `MonthGrid` | the month cells + tag dots. Always 42 cells, so the card never changes height between months. Arrow keys move focus between days (`moveFocus`, focus only; Enter selects) |
| `TagPicker` | color chips |
| `RepeatPicker` | segmented recurrence; `RuleExtras` holds its details (see above) |
| `openDeleteDialog` | **scoped delete** for recurring reminders: this occurrence vs the whole series → app.js `deleteReminder(scope, id, occKey)` |
| `ReminderRow` | one reminder: done checkbox, text, notes, then meta (time, own lead, second alert, `describeRepeat`). Shows a WhatsApp marker when enabled. "Snoozed till" (`snoozeLabel`, also used by Settings → Reminders) names the day when it isn't today, and is a button that cancels the snooze (`onCancelSnooze` → app.js `cancelReminderSnooze`) |
| form cache | `resetCalendarForm`, `buildForm` — the add-reminder form persists across repaints on purpose |
| `ReminderPanel` | the selected day, as **one node** (`.gb-cal-side`, which app.js swaps whole to repaint) holding two blocks: `.gb-cal-reminders` (date title, reminders, add form, schedule) and `.gb-cal-daylog` (wins, tasks, food). `.gb-cal-side` is `display: contents`, so `.gb-cal` lays the blocks out: on desktop a grid with the month and the day log on the left and reminders spanning the right (the second row is `1fr` so the tall reminders column can't open a gap under the month); on a phone, month → reminders → day log. The food-loading height hold goes on `.gb-cal-daylog` — the panel has no box |
| `ScreenCalendar` | assembles grid + panel |
| `CalendarToolbar` | month nav + counts |

**Time blocks / free-busy.** A reminder with both `time` and `endTime` is a busy block
("Meeting 15:00 to 16:00"). `freeBusy(list, key, routine)` paints the day minute by minute (1440
cells) and returns spans of one kind: `free | busy | custom | lunch | sleep`, earlier ones winning where they
overlap (each custom block paints its own cell value so two back to back stay two named spans),
and overlapping meetings form one span carrying every title. **The routine** (`ui_prefs.routine`:
`{bed, wake, lunchFrom, lunchTo, lunchDays, items: [{name, from, to, days}]}`, where `days` is
`'all' | 'work' | 'off'` (off = outside the working week) and `items` are the user's own blocks, at
most `ROUTINE_MAX` and none across midnight, set in `openRoutineDialog`, saved by
app.js `saveRoutine`, held as module state via `setRoutine` like the working week) turns the window
into all 24 hours: sleep may wrap midnight (painted 00:00-wake and bed-24:00), `work` lunch follows
the user's working week. With no routine the window is 08:00-22:00, stretched to fit any block
outside it. Week tiles use `wholeHours`, which rounds by largest remainder so they add up to 168h.
`openRoutineDialog` builds its parts into an array before `sheet.append(...)`: native `append`
writes a `null` argument out as the text "null". `ScheduleSection` holds the Day/Week toggle (`scheduleView`, session-only) and the
Routine button; `ScheduleCard` is one day, `WeekCard` Monday to Sunday around the selected day, each
row a button that opens that day. Point reminders (no end) never count as busy. No reminder block
crosses midnight. `scripts/calendar.test.mjs` covers `freeBusy`, routine cases included.

`TimeRange(start, end)` is the start/end pair in both the add form and the edit dialog: the end is
disabled until there is a start, and has its own clear button, because a native time input has no
reliable way to empty it. Its check is the exported pure `timeRangeOk`, and the edit dialog's PATCH
is built by the exported pure `reminderEditPatch` (both tested in `app-logic.test.mjs`). **In a PATCH, a start sent with a null end clears the end** (the edit
dialog always sends the start), so a block can go back to being a plain reminder; an end sent alone
keeps the stored start.

Backend: `/api/reminders` (CRUD, `occurrences`, `day/{date}`, `{id}/done`, `{id}/snooze`,
`export.ics`; full list in CODEMAP). Java tests: `SharedRecurrenceCasesTest` (the shared cases),
`ReminderRichRulesTest` (rule edges, done suppression, second alert, quiet hours, .ics).
Styles: `app.css` §"Calendar screen" and §"Delete-scope modal".
