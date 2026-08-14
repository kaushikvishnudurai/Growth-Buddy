# habit/HabitService.java — 546 lines

Backs `/api/habits`. Owns habits, daily check-ins, cached streak counters, and the **streak-freeze
wallet** (the server is the authority on freeze tokens; the frontend only reads fields and calls
protect/unprotect).

`FREEZE_CAP = 2` (line 23) — the wallet holds at most 2 tokens; one is granted per ISO week.

| Method | Line | Notes |
|---|---|---|
| `list(userId)` | 127 | habits + streaks + freeze state, the screen's main read |
| `create(userId, req)` | 220 | |
| `update(userId, id, req)` | 235 | |
| `delete(userId, id)` | 266 | |
| `checkin(userId, id, req)` | 274 | `date` defaults to today, `done` defaults to true; **recomputes `HabitStreak`** |
| `toggleToday(userId, id)` | 307 | |
| `freezeStatus(userId)` | 71 | wallet snapshot (`GET /api/habits/freeze`) |
| `protect(userId, id, date)` | 77 | spends a token to shield a missed day |
| `unprotect(userId, id, date)` | 110 | refunds it |
| `contextSummary(userId)` | 162 | read-only text summary fed to the mentor/LLM prompts |
| `countDoneBetween(userId, start, end)` | 180 | single user |
| `countDoneBetween(List<UUID>, start, end)` | 186 | batched — **use this for leaderboards**, not the single-user version in a loop (Circle challenge ranking depends on it) |
| `todayCounts(userId)` | 199 | `record TodayCounts(int done, int total)` (216), used by the score |

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
- `StreakFreezeWallet` grants 1 free token per ISO week, capped at `FREEZE_CAP`.
- Enums `Cadence` (`daily`/`weekly`/`custom`) and `HabitDomain` (`habit`/`fitness`/`study`/`journal`)
  are **lowercase to match the MySQL ENUM values** — renaming a constant breaks reads.

DTOs: `HabitDtos`. Repositories: `HabitRepositories`. Frontend: `ScreenHabits` in `scripts/app.js`
(~4940) plus the habit cards in `scripts/dashboard.js`; the client-side freeze layer sits at
`app.js` 413–560.
