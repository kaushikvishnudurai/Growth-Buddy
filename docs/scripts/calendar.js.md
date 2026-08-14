# scripts/calendar.js — Calendar screen (1022 lines)

Exports (~1016): `ScreenCalendar`, `CalendarToolbar`, `MonthGrid`, `ReminderPanel`,
`resetCalendarForm` (confirm the exact list in the export block).

Shows reminders (with color tags + recurrence), tasks due, completed tasks, goal action dates,
per-day food, and read-only Google Calendar events. app.js drives month navigation and does
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
- `remindersOn` (149), `tasksOn` (162), `completedTasksOn` (179), `goalActionsOn` (185), `dueKey` (155).

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

Backend: `/api/reminders` (CRUD, `occurrences`, `day/{date}`), `/api/google/calendar/events`.
Styles: `app.css` §"Calendar screen" (~3010) and §"Delete-scope modal" (~3797).
