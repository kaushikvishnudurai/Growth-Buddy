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
| `history(userId, id, days)` | 77 | `GET /api/habits/{id}/history` — `{since, days[]}` for the freeze calendar. `since` is the habit's creation date in the user's zone, so the client can tell a missed day from one before the habit existed |
| `protect(userId, id, date)` | 77 | spends a token to shield a missed day |
| `unprotect(userId, id, date)` | 110 | refunds it |
| `contextSummary(userId)` | 162 | read-only text summary fed to the mentor/LLM prompts |
| `countDoneBetween(userId, start, end)` | 180 | single user |
| `countDoneBetween(List<UUID>, start, end)` | 186 | batched — **use this for leaderboards**, not the single-user version in a loop (Circle challenge ranking depends on it) |
| `todayCounts(userId)` | 205 | `record TodayCounts(int done, int total)` (231), used by the score |
| `countsOn(userId, day)` | 214 | the same counts for **any** day — check-ins are stored against a log date, so a finished day still answers truthfully. What the digest reads, since it reports a day the midnight sweep has already rolled. |

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
(~4940) plus the habit cards in `scripts/dashboard.js`; the client-side freeze layer sits at
`app.js` 413–560.
