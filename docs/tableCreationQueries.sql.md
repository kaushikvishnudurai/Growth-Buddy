# SQL schema — `tableCreationQueries.sql` + `growth_buddy.sql`

**Two files, different jobs:**

| File | What it is |
|---|---|
| `tableCreationQueries.sql` | hand-written DDL, the schema of record. One guarded `CREATE TABLE IF NOT EXISTS` per table (count them with `grep -c '^CREATE TABLE'`; a number written here went stale), with old migrations left as comments — the one live `ALTER` is the idempotent `MODIFY COLUMN` widening `family_members.status`'s ENUM; column adds go to `migrations.sql`. **Runnable against a fresh database, against prod, and twice.** **In sync with the live DB as of v6** — the 11 tables ddl-auto had created but nobody had written down were captured from `SHOW CREATE TABLE` and appended, and 11 phantom tables that had no entity and existed nowhere were deleted. |
| `growth_buddy.sql` | a real `mysqldump` of a working DB (backticked identifiers). Untracked in git, and **stale** — it still holds the dropped Google tables. Re-dump it when you care. |

`application.yml` sets `ddl-auto: ${SPRING_JPA_DDL_AUTO:update}`, so dev papers over any gap:
Hibernate creates missing tables and columns on the fly. **`application-prod.yml` sets
`ddl-auto: ${SPRING_JPA_DDL_AUTO:none}`** — not `validate`, whatever older notes say — so prod adds
nothing and checks nothing. This file is the only thing that ever changes the live schema:

- **A new table** → its `CREATE TABLE IF NOT EXISTS` here. `SchemaCoverageTest` fails the build
  without it. That is how the 11-table gap opened up.
- **A new column on a table that already exists** → the `CREATE TABLE` here (for fresh installs)
  **and** an `ALTER` line in **`migrations.sql`** (for the live one). A column that only ever lands
  in the `CREATE TABLE` reaches a fresh database and never prod, and the first query that selects it
  500s. This file alters nothing at all now — a bare `ALTER` aborts the load on whichever database
  already has the column, which is how two fresh loads stopped half-way, and `SchemaCoverageTest`
  fails the build on one.

**Prod is TiDB**, which has no stored procedures — so the migrations are plain `ALTER`s with a check
query at the top of `migrations.sql` telling you which ones this database still needs. Run the check,
run only what it reports MISSING. Nothing in either file deletes or rewrites a row.

The last section, "TABLES CAPTURED FROM THE LIVE DB", is verbatim `SHOW CREATE TABLE` output — no FK
to `users(id)` and `utf8mb4_0900_ai_ci` collation, unlike the hand-written sections above. Left as-is
so it provably matches the running database.

## Tables in `tableCreationQueries.sql` (by area)

| | |
|---|---|
| users · password_credentials · sessions | identity |
| email_verification_tokens · password_reset_tokens · whatsapp_otp_tokens | one-time codes (bcrypt hashes only) |
| email_change_tokens · user_totp | change-email codes (bcrypt hash + the `new_email` they prove); authenticator 2FA — `secret_enc` is AES-GCM ciphertext (`TotpService`), `recovery_codes` a JSON array of bcrypt hashes, `enabled_at` NULL = setup pending. `users.deletion_requested_at` = account scheduled for deletion (purged 7 days later) |
| tasks · task_completion_history | tasks (`tasks.goal_id` NULL = on no goal; no FK, since `tasks` is created before `goals` — `GoalService.delete` clears it) |
| habits · habit_checkins · habit_streaks · streak_freeze_wallets | habits |
| water_goals · water_entries | water |
| food_entries · food_favourites · food_photo_logs · food_diet_checks | food (`food_entries.meal_slot` null on pre-slot rows; `sugar_g`/`sodium_mg` only from a barcode label; `food_favourites` is a copy of a starred entry); `water_entries.drink_type` null = water; the last one stores Buddy's diet check per `(user_id, scope)` with the prompt it answered, so a changed day is a miss rather than something to invalidate |
| goals · goal_actions | goals |
| daily_scores · daily_logs | scoring & wellness |
| quotes | quotes |
| mentor_threads · mentor_messages | mentor chat (`mentor_messages.actions_json` = the one-tap actions a reply offered, JSON array, NULL = none) |
| circles · circle_members · circle_posts · circle_post_reactions · circle_challenges | circles (`circle_post_reactions` = kudos, PK `(post_id, user_id)`: one per member per post, toggled) |
| notes · note_drafts · note_edit_drafts | notes (`labels` comma-joined, `archived_at`, `deleted_at` = the Trash); `note_drafts` = the composer's unsaved note, one per user; `note_edit_drafts` = an open edit's autosave, one per note, `labels` included (`''` = all removed, NULL = a pre-labels row) — saving or deleting the note drops it |
| custom_sounds | the user's own notification sounds (≤5 per account): raw bytes in `audio` + `content_type`, `name`, `source` recording/file; `data_url` is the pre-bytes column, converted on first GET |
| rate_limit_counters · login_attempts | `RateLimiter` / `LoginAttemptGuard` state (and FoodWeek's estimate backoff, key `food-estimate:<userId>`), shared across instances; keys are SHA-256 hashes, no user data |
| mentorship_messages | the thread inside an accepted mentorship link (`link_id` = `mentorship_requests.id`); `kind` message / cheer / nudge — the daily nudge cap counts these rows |
| notifications · push_subscriptions | notifications (`kind` ENUM gained `buddy_checkin`: the evening reflection) |
| mentorship_requests | mentorship |
| calendar_reminders · calendar_reminder_skips · reminder_done · reminder_dispatch_log · habit_reminder_dispatch_log | calendar reminders (`reminder_done` = one occurrence checked off, unique `(reminder_id, occurrence_date)`: not delivered, no device alarm); `habit_reminder_dispatch_log` = the habit reminder scheduler's de-dupe; a snooze's `reminder_dispatch_log` row carries `snooze_of` (the reminder; its `reminder_id` is name-derived) and `attempts`, status `pending` → `sent`/`failed` (the scheduler's at-least-once snooze sweeper) |
| focus_sessions · weekly_reviews | focus & weekly review |
| families · family_members · family_meal_plans · family_dish_preferences · family_pantry_items · family_shopping_items · family_favourite_menus · family_multi_day_plans · family_recipes · family_chores | family (`family_recipes` one per `(family_id, dish_key)`; `family_chores` with optional assignee member, `due_date`, `repeat_rule`, `done_at`) |
| money_state | **the Money document minus the ledger: `user_id`, `data` JSON, `updated_at`** |
| money_accounts · money_transactions | Money ledger: accounts (balance computed), one row per expense/income/transfer keyed `(user_id, id)`. (`money_day_summaries`, the old AI day-summary cache, is dropped by `migrations.sql`.) |

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
  90 days, `reminder_dispatch_log` / `habit_reminder_dispatch_log` older than 30 days,
  `food_diet_checks` older than 8 days, and `food_photo_logs` past each user's newest 12. The other append-only tables
  (`task_completion_history`, `focus_sessions`) are **not** trimmed — they back
  user-visible history. Add one to the job only once you're sure nothing reads its old rows.
