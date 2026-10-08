# scripts/calendar.js — Calendar screen (1022 lines)

Exports (~1016): `ScreenCalendar`, `CalendarToolbar`, `MonthGrid`, `ReminderPanel`,
`resetCalendarForm` (confirm the exact list in the export block).

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
  `ReminderServiceOccursOnTest` are mirrors of each other — change one, change both.
- Repeat options: `none`, `daily`, `weekdays`, `weekly`, `monthly`, `yearly`. The column is
  `varchar(16)`, so a new value needs no migration. **`weekdays` means the user's working week**,
  not Mon-Fri — `REPEATS.weekdays.label` is a *getter* reading `WORK_WEEKS[getWorkWeek()]`. The
  getter alone isn't enough for the segmented control: the form DOM is cached for the session, so
  its button text is a snapshot. `ReminderPanel` calls `repeatPicker.relabel()` on every render to
  re-read the getter. `REPEATS[x].phrase` exists only for the
  delete dialog's "repeats ___" sentence, where `label.toLowerCase()` would read "repeats mon-fri".
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
- **Each reminder can carry its own tone.** The form's Tone `<select>` sends a chime key from
  `chime.js`; an empty value means "the default from Alerts", which is stored as null so the
  reminder keeps following that setting when it changes. A `<select>` and not the segmented control
  the Alerts pane uses — six options don't fit the side panel. Picking one previews it; picking
  "Default tone" previews nothing, because this file doesn't know which tone that is. The tone is
  set at creation: there is no reminder-edit flow to change it in.
- **Past days are read-only.** `ReminderPanel` computes `pastDate` and drops the whole form block
  for any day before today, so a reminder can only be filed on today or later. `app.js`
  `addReminder()` refuses a past `key` for every caller, and `ReminderService.create` rejects it
  server-side — with **one day of slack**, because "today" there is the user's stored timezone,
  which falls back to UTC, and a UTC server is already on tomorrow while half the world is not.

## Components

| Fn | Line | Notes |
|---|---|---|
| `MonthGrid` | 854 | the month cells + tag dots. Always 42 cells, so the card never changes height between months. Arrow keys move focus between days (`moveFocus`, focus only; Enter selects) |
| `TagPicker` | 278 | color chips |
| `RepeatPicker` | 313 | segmented recurrence |
| `openDeleteDialog` | 345 | **scoped delete** for recurring reminders: this occurrence vs the whole series → app.js `deleteReminder(scope, id, occKey)` |
| `ReminderRow` | 434 | one reminder; shows a WhatsApp marker when enabled |
| form cache | 512–535 | `resetCalendarForm`, `buildForm` — the add-reminder form persists across repaints on purpose |
| `ReminderPanel` | 615 | selected-day list + add form |
| `ScreenCalendar` | 884 | assembles grid + panel |
| `CalendarToolbar` | 956 | month nav + counts |

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
reliable way to empty it. **In a PATCH, a start sent with a null end clears the end** (the edit
dialog always sends the start), so a block can go back to being a plain reminder; an end sent alone
keeps the stored start.

Backend: `/api/reminders` (CRUD, `occurrences`, `day/{date}`).
Styles: `app.css` §"Calendar screen" (~3010) and §"Delete-scope modal" (~3797).
