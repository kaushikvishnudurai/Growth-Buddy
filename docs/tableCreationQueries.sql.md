# SQL schema — `tableCreationQueries.sql` (746 lines) + `growth_buddy.sql`

**Two files, different jobs:**

| File | What it is |
|---|---|
| `tableCreationQueries.sql` | hand-written DDL, the schema of record. 44 `CREATE TABLE`s. **In sync with the live DB as of v6** — the 11 tables ddl-auto had created but nobody had written down were captured from `SHOW CREATE TABLE` and appended, and 11 phantom tables that had no entity and existed nowhere were deleted. |
| `growth_buddy.sql` | a real `mysqldump` of a working DB (backticked identifiers). Untracked in git, and **stale** — it still holds the dropped Google tables. Re-dump it when you care. |

`application.yml` sets `ddl-auto: ${SPRING_JPA_DDL_AUTO:update}`, so dev papers over any gap:
Hibernate creates missing tables on the fly. Prod is meant to run `validate` against this file, so
**an entity added without its table here works in dev and breaks the next prod deploy.** That is how
the 11-table gap opened up. Add the table in the same change as the entity.

The last section, "TABLES CAPTURED FROM THE LIVE DB", is verbatim `SHOW CREATE TABLE` output — no FK
to `users(id)` and `utf8mb4_0900_ai_ci` collation, unlike the hand-written sections above. Left as-is
so it provably matches the running database.

## Tables in `tableCreationQueries.sql` (line → table)

| | |
|---|---|
| 21 users · 45 password_credentials · 54 sessions | identity |
| 71 email_verification_tokens · 81 password_reset_tokens · 499 whatsapp_otp_tokens | one-time codes (bcrypt hashes only) |
| 93 tasks · 111 task_completion_history | tasks |
| 127 habits · 143 habit_checkins · 157 habit_streaks · 168 streak_freeze_wallets | habits |
| 179 water_goals · 188 water_entries | water |
| 205 food_entries · 228 food_photo_logs | food |
| 245 goals · 263 goal_actions | goals |
| 284 daily_scores · 301 daily_logs | scoring & wellness |
| 324 quotes | quotes |
| 334 mentor_threads · 344 mentor_messages | mentor chat |
| 358 circles · 369 circle_members · 380 circle_posts · 395 circle_challenges | circles |
| 427 notifications · 643 push_subscriptions | notifications |
| 448 mentorship_requests | mentorship |
| 606 calendar_reminders · 622 calendar_reminder_skips · 630 reminder_dispatch_log | calendar reminders |
| 654 focus_sessions · 665 weekly_reviews | focus & weekly review |
| 518 families · 528 family_members · 553 family_meal_plans · 677 family_dish_preferences · 689 family_pantry_items · 705 family_shopping_items · 720 family_favourite_menus · 733 family_multi_day_plans | family |
| 589 money_state | **the whole Money doc: `user_id`, `data` JSON, `updated_at`** |

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
