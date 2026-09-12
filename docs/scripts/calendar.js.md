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
  not Mon-Fri — `REPEATS.weekdays.label` is a *getter* reading `WORK_WEEKS[getWorkWeek()]`, so the
  segmented control relabels itself when Settings changes. `REPEATS[x].phrase` exists only for the
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
- **Past days are read-only.** `ReminderPanel` computes `pastDate` and drops the whole form block
  for any day before today, so a reminder can only be filed on today or later. `app.js`
  `addReminder()` refuses a past `key` for every caller, and `ReminderService.create` rejects it
  server-side — with **one day of slack**, because "today" there is the user's stored timezone,
  which falls back to UTC, and a UTC server is already on tomorrow while half the world is not.

## Components

| Fn | Line | Notes |
|---|---|---|
| `MonthGrid` | 210 | the month cells + tag dots |
| `TagPicker` | 278 | color chips |
| `RepeatPicker` | 313 | segmented recurrence |
| `openDeleteDialog` | 345 | **scoped delete** for recurring reminders: this occurrence vs the whole series → app.js `deleteReminder(scope, id, occKey)` |
| `ReminderRow` | 434 | one reminder; shows a WhatsApp marker when enabled |
| form cache | 512–535 | `resetCalendarForm`, `buildForm` — the add-reminder form persists across repaints on purpose |
| `ReminderPanel` | 615 | selected-day list + add form |
| `ScreenCalendar` | 884 | assembles grid + panel |
| `CalendarToolbar` | 956 | month nav + counts |

Backend: `/api/reminders` (CRUD, `occurrences`, `day/{date}`).
Styles: `app.css` §"Calendar screen" (~3010) and §"Delete-scope modal" (~3797).
