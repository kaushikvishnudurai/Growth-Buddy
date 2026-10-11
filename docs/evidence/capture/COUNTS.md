# Capture loop: inputs before and after

Before = the audit's counts (docs/audit/friction-capture.md, 390x844). After = what
e2e/capture.spec.mjs drives and asserts on branch ov1011/capture, merged with main build 95.
Taps count every press, Enter included; a field already focused costs no tap.

| Flow | Before (taps / fields / decisions / screens) | After | Asserted in |
|---|---|---|---|
| Quick add a task ("need to buy milk") | 4 / 1 / 1 / 3 | 2 / 1 / 0 / 1 (model read); 3 / 1 / 1 / 2 (fallback read) | `need to buy milk`, `without the assistant` |
| Quick add an expense ("spent 250 on lunch") | 4 / 1 / 1 / 3, no account | 2 / 1 / 0 / 1, default account (Cash) named in the toast | `expense lands` |
| Quick add income ("got salary 50000") | 4 / 1 / 1 / 3, no account | 2 / 1 / 0 / 1, lands in Bank | `income lands` |
| Quick add "slept 7h, feeling good" on a logged day | 4 / 1 / 1 / 3, overwrote 23:00-06:30 with 00:00-07:00 and energy to medium | 3 / 1 / 1 / 2 (two things: previewed), keeps the 06:30 wake, quality and energy; the row says "replaces 11:00 PM to 6:30 AM" | `slept 7h` |
| One-off reminder at an hour already gone ("remind me at 9pm ..." at 21:30) | refused, two error toasts | 2 / 1 / 0 / 1, booked tomorrow, no error toast, Undo | `hour already gone` |
| Weekly reminder ("every monday at 9am ...") | 4 / 1 / 1 / 3 via Quick add (6 / 2 / 3 / 3 in Calendar) | 2 / 1 / 0 / 1 | `weekly reminder` |
| Note ("note: gift idea ...") | 4 / 1 / 0 / 3 | 2 / 1 / 0 / 1 | `a note is one line` |
| Quick add's Note row | 4 taps to a focused composer | 2 taps, composer open and focused | `a note is one line` |
| Task with a due time ("Call plumber tomorrow 5pm") | 7 / 2 / 2 / 2 (date-time picker), and the words stayed in the title | 2 / 1 / 0 / 2: title "Call plumber", due tomorrow 17:00, chip removable | `Call plumber` |
| Morning sleep + mood on Home | 2 taps (Yes, then the mood) | 1 tap: the mood also logs the night the card is asking about, toast with Edit | `one mood tap` |
| Plan my day after 21:00 | 2 taps, listed gone reminders, "Looks good" wrote nothing | 2 taps: "Tomorrow plan", tomorrow's reminders, "Add to tomorrow" writes tomorrow's focus blocks | `plan my day after 21:00` |

Every Quick add write now has a way back: Undo on the toast removes the task, note (for good),
reminder, money row, water glass, food entry, habit tick or new habit/goal, and restores a sleep or
mood that was already logged. A first sleep or mood of the day has no delete on the server, so that
toast offers Edit instead.

Paths seen: in the recorded runs the gateway answered (model path) for every sentence; the
fallback path is forced in `without the assistant` (the response's `unavailable` flag set by a
route), so both are covered.

Screenshots: FRC-2.jpg, FRC-3.jpg, FRC-4.jpg, FRC-5-note.jpg, FRC-8.jpg, FRC-9.jpg, FRC-11.jpg, EXS-5.jpg.
