# SQL schema — `tableCreationQueries.sql` (801 lines) + `growth_buddy.sql`

**Two files, different jobs:**

| File | What it is |
|---|---|
| `tableCreationQueries.sql` | hand-written DDL, the "intended" schema. 46 `CREATE TABLE`s. **Lags behind the entities** — it has no `push_subscriptions`, `weekly_reviews`, `reminder_dispatch_log`, `focus_sessions`, or the newer family tables. |
| `growth_buddy.sql` | a real `mysqldump` of a working DB (backticked identifiers), 46 tables, and it *does* include `push_subscriptions`, `reminder_dispatch_log`, `weekly_reviews`. Currently **untracked** in git. |

Dev gets away with the gap because `application.yml` sets
`ddl-auto: ${SPRING_JPA_DDL_AUTO:update}` — **Hibernate creates missing tables on the fly**. Prod is
meant to run `validate` with the schema owned by the SQL file. So: if you add an entity, dev works
immediately and prod breaks later. Add the table to the SQL file in the same change.

## Tables in `tableCreationQueries.sql` (line → table)

| | |
|---|---|
| 21 users · 44 user_preferences · 56 auth_identities · 68 password_credentials · 77 sessions | identity |
| 94 email_verification_tokens · 104 password_reset_tokens · 672 whatsapp_otp_tokens | one-time codes (bcrypt hashes only) |
| 118 task_templates · 133 recurrences · 148 tasks · 169 task_completion_history | tasks |
| 185 habits · 201 habit_checkins · 215 habit_streaks · 226 streak_freeze_wallets | habits |
| 237 water_goals · 246 water_entries | water |
| 264 food_entries · 288 food_photo_logs | food |
| 305 goals · 323 goal_actions | goals |
| 337 gratitude_entries · 384 journal_entries | journaling |
| 352 workouts · 368 workout_exercises | fitness |
| 401 daily_scores · 418 daily_logs · 564 xp_events | scoring & wellness |
| 441 quotes | quotes |
| 451 mentor_threads · 461 mentor_messages | mentor chat |
| 475 circles · 486 circle_members · 497 circle_posts · 512 circle_challenges | circles |
| 600 notifications · 529 device_tokens | notifications |
| 621 mentorship_requests | mentorship |
| 543 reminders | calendar reminders |
| 691 families · 701 family_members · 726 family_meal_plans | family |
| 762 money_state | **the whole Money doc: `user_id`, `data` JSON, `updated_at`** |
| 776 google_calendar_links · 789 google_oauth_settings | Google integration |

## Conventions

- **UUID PKs are `char(36)` text**, not `BINARY(16)`. That is why
  `hibernate.type.preferred_uuid_jdbc_type: CHAR` in `application.yml` is load-bearing — without it
  every UUID lookup misses and `ddl-auto: update` breaks.
- Several columns are MySQL `ENUM`s whose values are matched by **lowercase Java enum constant
  names** (`Cadence`, `HabitDomain`, `MessageRole`, `ReminderTag`, `RepeatFreq`, `NotificationKind`).
  `Priority` is the exception: `'Low','Medium','High'`, capitalized.
- Append-only tables (`task_completion_history`, `xp_events`, `reminder_dispatch_log`,
  `focus_sessions`) are trimmed by `config/DataCleanupJob` nightly to stay inside a small hosting
  quota. Don't start reading old rows from them without revisiting that job.
