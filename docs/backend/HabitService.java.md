# habit/HabitService.java — ~1150 lines

Backs `/api/habits`. Owns habits, daily check-ins, cached streak counters, and the **streak-freeze
wallet** (the server is the authority on freeze tokens; the frontend only reads fields and calls
protect/unprotect).

`FREEZE_CAP = 2` — the wallet holds at most 2 tokens; one is granted per ISO week.
`HISTORY_WINDOW_DAYS = 400` — how far back the read paths (`list`, single-habit responses,
`history`) load check-ins. A live run longer than that falls back to the cached `HabitStreak`
(`liveOrCached`: a run still going was recomputed from full history by the tick that extended it;
a broken run reads 0 live and the stale cache is ignored). `recomputeStreak` (mutations) still
reads the full history.

| Method | Notes |
|---|---|
| `list(userId)` | habits + streaks + freeze state, the screen's main read (and the one that pays quit habits' clean days: `creditCleanDays`), in the user's order (`sort_order`, then `created_at` for ties — every habit from before the column is 0). Each `HabitResponse` also carries `dueToday` (same rule as `countsOn`), `doneThisWeek` and `todayNote`, `kind` |
| `create(userId, req)` | `kind: quit` forces daily / 7 / metric none and sets `cleanCreditedThrough` to the day before today; kind is create-only (`UpdateHabitRequest` has none, and `update` keeps a quit habit daily and unmeasured). |
| `create` (order) | goes to the bottom of the order (`nextSortOrder`: last + 1; left at 0 it tied with the first habit and landed second). `icon` must be in `HABIT_ICONS` (also on update); `HabitIconsTest` keeps it in step with the JS lists. `targetPerWeek` is `@Min(1) @Max(7)` |
| `update(userId, id, req)` | null = unchanged; a blank name is ignored; `clearReminder: true` is the only way to remove a reminder time; `active: false` pauses (out of the score, Home's count and reminders). A new cadence / target **recomputes the streak** — the cache is in the old cadence's units and the read path trusts it for long runs |
| `delete(userId, id)` | |
| `reorder(userId, ids)` | `PUT /api/habits/order` → the list in its new order. The numbering is `applyOrder` (static, `HabitOrderTest`): listed ids first in that order, every habit left out keeps its relative place after them (a stale client can't drop one), a repeated id counts once, an id that isn't one of the user's live habits 404s before anything is renumbered; only rows whose position changed are saved |
| `checkin(userId, id, req)` | `date` defaults to today; refused: a date after the user's today, more than `CHECKIN_BACK_DAYS` (7, = `canEditDay`'s `maxBack` in `habit-stats.js`) before it, or before the habit's creation day in the user's zone, `done` defaults to true; an absent `note` leaves the stored one; **recomputes `HabitStreak`**. **XP once per habit per day:** awarded only when the day had no row yet, or was a protected day — un-ticking keeps the row, so tick/untick/tick no longer pays each round (and a fresh row now starts `done = false`; the entity default `true` used to make every first tick look like a re-tick). Known gap: tick / untick / protect / tick pays again, bounded by the freeze-token cap |
| `toggleToday(userId, id)` | |
| `freezeStatus(userId)` | wallet snapshot (`GET /api/habits/freeze`) |
| `history(userId, id, days)` | `GET /api/habits/{id}/history` — `{since, days[]}` for the freeze calendar and the history panel; each day is `HabitDay.of(row)` = `{date, done, protectedDay, note}`. `since` is the habit's creation date in the user's zone, so the client can tell a missed day from one before the habit existed |
| `historyAll(userId, days)` | `GET /api/habits/history` — the same `{since, days[]}` for every habit, keyed by habit id, from ONE check-in query (`findByUserIdAndLogDateGreaterThanEqual…`). `days` clamped to 1..`HISTORY_WINDOW_DAYS` (`clampHistoryDays`). Insights' read |
| `protect(userId, id, date)` | spends a token to shield a missed day; refuses a future day, a day before the habit's creation date (in the user's zone), and any day of a quit habit |
| `unprotect(userId, id, date)` | refunds it |
| `contextSummary(userId)` | read-only text summary fed to the mentor/LLM prompts |
| `countDoneBetween(userId, start, end)` | single user |
| `countDoneBetween(List<UUID>, start, end)` | batched — **use this for leaderboards**, not the single-user version in a loop (Circle challenge ranking depends on it) |
| `todayCounts(userId)` | `record TodayCounts(int done, int total)`, used by the score |
| `countsOn(userId, day)` | the same counts for **any** day — check-ins are stored against a log date, so a finished day still answers truthfully. What the digest reads, since it reports a day the midnight sweep has already rolled. Counts only habits **owed** that day (`countDue` / `isDue`): active, created by then, and — for weekly / N-a-week — the week's quota not yet met on an earlier day. A habit done that day always counts, as done. A quit habit counts every day it is active and existed, as done unless that day holds its slip — so `countsOn` reads every row of the week (`findByUserIdAndLogDateBetween`), not just done ones. Soft-deleted habits and their check-ins are out. |

## Break a habit (`HabitKind.quit`)

`habits.kind` (`build` default | `quit`). A quit habit's day is **clean unless a slip is logged**; a slip is
a check-in row with `done = false` and `protected_day = false` (`isSlip`). `done = true` on a quit row
only takes a slip back or carries a clean day's note; `toggleToday` logs / undoes today's slip.

- **Streak** = `quitStreak(today, start, lastSlip)`: days since the last slip (or since `startDay`, the
  creation date in the user's zone), today included unless slipped — day one reads 1. Longest =
  `longestQuitRun`. `HabitStreak.lastDoneOn` holds the **last slip** on a quit habit (null = never),
  which the read path (`quitResponse`) falls back to when no slip is inside the 400-day window;
  `contextSummary` / `streakLines` work the streak out from it too, since a quit streak grows with no
  mutation to refresh the cache.
- **Response**: `doneToday` = active and not slipped today; `dueToday` = `isDue`; `doneThisWeek` =
  clean days this week; never `atRisk`, never protected.
- **XP, each clean day once**: `checkin` never pays a quit habit. `list` runs `creditCleanDays`:
  `creditableCleanDays` counts the non-slip days after `cleanCreditedThrough` up to **yesterday**
  (today can still be slipped), bounded to the read window, zero while paused; it pays them through
  `ProgressService.awardHabitCleanDays` and moves the marker to yesterday. A slip logged on a paid day
  takes nothing back; un-slipping pays nothing again. ponytail: the pause state at settle time stands
  for the whole unpaid span.
- Not covered on purpose: Circle's `countDoneBetween` sees only a quit habit's explicit `done` rows,
  Insights skips quit habits (`insights.js`), and the reminder scheduler still nudges one daily.

## Timezone

Every method resolves the user's own today **once** via `UserClock.today(userId)` and threads
it through (`wallet(userId, today)`, `recomputeStreak(habit, today)`, `currentDailyRun(today, …)`,
`currentWeeklyRun(today, …)`). Do not reintroduce `LocalDate.now()` here: on a UTC container an
IST user's 1am check-in would file under yesterday and break the streak. `UserClock` takes the
user id rather than reading `CurrentUser` because the digest scheduler reaches this service
(via `ScoreService`) outside any request.

## Model notes

- `HabitCheckin` has a **composite PK (habit_id, log_date)** — one check-in per habit per day. Insert
  paths must upsert, not blind-insert.
- `HabitStreak` is a **cache**, recomputed on every check-in change. If a streak looks wrong, the bug
  is in the recompute inside `checkin`, not in the read path.
- `StreakFreezeWallet` grants 1 free token per ISO week, capped at `FREEZE_CAP`. Nothing spends a
  token on its own — `protect` is the only writer, and it is always a user action. The freeze
  calendar (`openFreezeCalendar` in `app.js`) is what reaches it for an arbitrary past day; the
  at-risk prompt and the rest-day toggle still cover only yesterday and today.
- Enums `Cadence` (`daily`/`weekly`/`custom`) and `HabitDomain` (`habit`/`fitness`/`study`/`journal`)
  are **lowercase to match the MySQL ENUM values** — renaming a constant breaks reads.

DTOs: `HabitDtos`. Repositories: `HabitRepositories`. Frontend: `ScreenHabits` in `scripts/app.js`
 plus the habit cards in `scripts/dashboard.js`; the client-side freeze layer is around
`reconcileStreakFreeze` / `habitFreezeState` in `app.js`. Tests: `HabitQuitTest` (quit streak / longest run, countDue, clean-day XP once, slip toggle, no freeze,
stays daily), `HabitStreakFreezeTest` (daily
run math), `HabitServiceRulesTest` (due-today counts, XP once, refused dates, weekly/custom streaks,
at-risk, wallet top-up/cap, unprotect refund, the cached-streak fallback).
