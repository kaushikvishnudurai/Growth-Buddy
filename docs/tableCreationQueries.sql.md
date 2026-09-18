# SQL schema — `tableCreationQueries.sql` (836 lines) + `growth_buddy.sql`

**Two files, different jobs:**

| File | What it is |
|---|---|
| `tableCreationQueries.sql` | hand-written DDL, the schema of record. 47 guarded `CREATE TABLE`s plus an add-if-missing migration block at the end. **Runnable against a fresh database, against prod, and twice.** **In sync with the live DB as of v6** — the 11 tables ddl-auto had created but nobody had written down were captured from `SHOW CREATE TABLE` and appended, and 11 phantom tables that had no entity and existed nowhere were deleted. |
| `growth_buddy.sql` | a real `mysqldump` of a working DB (backticked identifiers). Untracked in git, and **stale** — it still holds the dropped Google tables. Re-dump it when you care. |

`application.yml` sets `ddl-auto: ${SPRING_JPA_DDL_AUTO:update}`, so dev papers over any gap:
Hibernate creates missing tables and columns on the fly. **`application-prod.yml` sets
`ddl-auto: ${SPRING_JPA_DDL_AUTO:none}`** — not `validate`, whatever older notes say — so prod adds
nothing and checks nothing. This file is the only thing that ever changes the live schema:

- **A new table** → its `CREATE TABLE IF NOT EXISTS` here. `SchemaCoverageTest` fails the build
  without it. That is how the 11-table gap opened up.
- **A new column on a table that already exists** → the `CREATE TABLE` above (for fresh installs)
  **and** a `CALL gb_add_column('table', 'col', 'col TYPE …')` in the block at the end. A column
  that only ever lands in the `CREATE TABLE` reaches a fresh database and never the live one, and
  the first query that selects it 500s. Never a bare `ALTER TABLE … ADD COLUMN` — it aborts the
  load on whichever database already has the column, which is how two fresh loads stopped
  half-way; `SchemaCoverageTest` fails the build on one.

The last section, "TABLES CAPTURED FROM THE LIVE DB", is verbatim `SHOW CREATE TABLE` output — no FK
to `users(id)` and `utf8mb4_0900_ai_ci` collation, unlike the hand-written sections above. Left as-is
so it provably matches the running database.

## Tables in `tableCreationQueries.sql` (line → table)

| | |
|---|---|
| 27 users · 49 password_credentials · 58 sessions | identity |
| 75 email_verification_tokens · 85 password_reset_tokens · 505 whatsapp_otp_tokens | one-time codes (bcrypt hashes only) |
| 95 tasks · 113 task_completion_history | tasks |
| 129 habits · 145 habit_checkins · 159 habit_streaks · 170 streak_freeze_wallets | habits |
| 181 water_goals · 190 water_entries | water |
| 207 food_entries · 230 food_photo_logs | food |
| 247 goals · 265 goal_actions | goals |
| 282 daily_scores · 299 daily_logs | scoring & wellness |
| 322 quotes | quotes |
| 332 mentor_threads · 342 mentor_messages | mentor chat |
| 356 circles · 367 circle_members · 378 circle_posts · 393 circle_challenges | circles |
| 422 notifications · 648 push_subscriptions | notifications |
| 443 mentorship_requests | mentorship |
| 609 calendar_reminders · 627 calendar_reminder_skips · 635 reminder_dispatch_log | calendar reminders |
| 659 focus_sessions · 670 weekly_reviews | focus & weekly review |
| 524 families · 534 family_members · 559 family_meal_plans · 682 family_dish_preferences · 694 family_pantry_items · 710 family_shopping_items · 725 family_favourite_menus · 738 family_multi_day_plans | family |
| 592 money_state | **the whole Money doc: `user_id`, `data` JSON, `updated_at`** |

## `users.timezone` is load-bearing

It decides which calendar day a user's check-ins, streaks, scores, wellness rows and water
entries land on (`UserClock`), as well as when reminders and digests are delivered. Populated
from the browser at signup and editable in Settings; validated on write, defaults to `'UTC'`.

## Conventions

- **UUID PKs are `char(36)` text**, not `BINARY(16)`. That is why
  `hibernate.type.preferred_uuid_jdbc_type: CHAR` in `application.yml` is load-bearing — without it
  every UUID lookup misses and `ddl-auto: update` breaks.
- Several columns are MySQL `ENUM`s whose values are matched by **lowercase Java enum constant
  names** (`Cadence`, `HabitDomain`, `MessageRole`, `ReminderTag`, `RepeatFreq`, `NotificationKind`).
  `Priority` is the exception: `'Low','Medium','High'`, capitalized.
- `config/DataCleanupJob` runs nightly to stay inside a small hosting quota, but it only trims rows
  nothing reads again: expired/revoked `sessions`, spent auth tokens, read `notifications` older than
  90 days, and `reminder_dispatch_log` older than 30 days. The other append-only tables
  (`task_completion_history`, `focus_sessions`) are **not** trimmed — they back
  user-visible history. Add one to the job only once you're sure nothing reads its old rows.
