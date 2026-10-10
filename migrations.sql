-- =====================================================================
-- Growth Buddy — migrations for a database that ALREADY EXISTS
--
-- `tableCreationQueries.sql` builds a new database and declares every column
-- in its CREATE TABLEs. It cannot help a database that is already running:
-- prod is TiDB with `ddl-auto: none`, so Hibernate adds nothing there, and a
-- column that only ever lands in a CREATE TABLE reaches a fresh database and
-- never the live one. The first query naming it then fails.
--
-- This file is the catalogue of every column added after a table's first
-- release. NOTHING HERE DELETES OR REWRITES DATA — every line adds a nullable
-- column, so existing rows get NULL and are not touched.
--
-- HOW TO USE IT: run the check below first, then run ONLY the lines it reports
-- as MISSING. Re-running an ALTER for a column that already exists is an error
-- that stops the script, and MySQL has no ADD COLUMN IF NOT EXISTS (TiDB does,
-- but this file stays portable). Adding a new column to an entity? Add it to
-- the CREATE TABLE over there AND append a line here.
-- =====================================================================

-- ---- The check: what is this database missing? ----------------------
SELECT  t.table_name  AS `table`,
        t.column_name AS `column`,
        IF(c.column_name IS NULL, 'MISSING — run its ALTER below', 'present') AS status
FROM (
  SELECT 'habits'                 AS table_name, 'color'        AS column_name
  UNION ALL SELECT 'habits'                 AS table_name, 'reminder_time'
  UNION ALL SELECT 'habits'                 AS table_name, 'sound'
  UNION ALL SELECT 'users'                  AS table_name, 'whatsapp_number'
  UNION ALL SELECT 'users'                  AS table_name, 'whatsapp_enabled'
  UNION ALL SELECT 'users'                  AS table_name, 'age_years'   
  UNION ALL SELECT 'users'                  AS table_name, 'height_cm'   
  UNION ALL SELECT 'users'                  AS table_name, 'weight_kg'   
  UNION ALL SELECT 'users'                  AS table_name, 'diet_preference'
  UNION ALL SELECT 'users'                  AS table_name, 'about_me'    
  UNION ALL SELECT 'users'                  AS table_name, 'daily_food_goal_kcal'
  UNION ALL SELECT 'users'                  AS table_name, 'daily_water_goal_ml'
  UNION ALL SELECT 'users'                  AS table_name, 'gender'      
  UNION ALL SELECT 'users'                  AS table_name, 'fitness_goal'
  UNION ALL SELECT 'users'                  AS table_name, 'whatsapp_verified'
  UNION ALL SELECT 'users'                  AS table_name, 'favourite_dish'
  UNION ALL SELECT 'users'                  AS table_name, 'allergic_to' 
  UNION ALL SELECT 'users'                  AS table_name, 'feature_prefs'
  UNION ALL SELECT 'users'                  AS table_name, 'ui_prefs'    
  UNION ALL SELECT 'family_members'         AS table_name, 'invite_only' 
  UNION ALL SELECT 'family_members'         AS table_name, 'height_cm'   
  UNION ALL SELECT 'family_members'         AS table_name, 'weight_kg'   
  UNION ALL SELECT 'mentorship_requests'    AS table_name, 'checked_at'  
  UNION ALL SELECT 'users'                  AS table_name, 'nav_layout'  
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'sound'       
  UNION ALL SELECT 'habits'                 AS table_name, 'metric'
  UNION ALL SELECT 'habit_checkins'         AS table_name, 'metric_value'
  UNION ALL SELECT 'habit_checkins'         AS table_name, 'duration_min'
  UNION ALL SELECT 'food_entries'           AS table_name, 'protein_g'
  UNION ALL SELECT 'food_entries'           AS table_name, 'carbs_g'
  UNION ALL SELECT 'food_entries'           AS table_name, 'fat_g'
  UNION ALL SELECT 'food_entries'           AS table_name, 'fiber_g'
  UNION ALL SELECT 'notes'                  AS table_name, 'cover'
  UNION ALL SELECT 'money_state'            AS table_name, 'sub_due_days'
  UNION ALL SELECT 'custom_sounds'          AS table_name, 'content_type'
  UNION ALL SELECT 'custom_sounds'          AS table_name, 'audio'
  UNION ALL SELECT 'tasks'                  AS table_name, 'push_count'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'end_time_of_day'
  UNION ALL SELECT 'tasks'                  AS table_name, 'paused'
  UNION ALL SELECT 'custom_sounds'          AS table_name, 'name'
  UNION ALL SELECT 'custom_sounds'          AS table_name, 'source'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'notify_before'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'snoozed_until'
  UNION ALL SELECT 'circles'                AS table_name, 'visibility'
  UNION ALL SELECT 'circles'                AS table_name, 'join_code'
  UNION ALL SELECT 'family_meal_plans'      AS table_name, 'cooked_at'
  UNION ALL SELECT 'mentor_messages'        AS table_name, 'fallback'
  UNION ALL SELECT 'users'                  AS table_name, 'deletion_requested_at'
  UNION ALL SELECT 'habits'                 AS table_name, 'sort_order'
  UNION ALL SELECT 'habits'                 AS table_name, 'kind'
  UNION ALL SELECT 'habits'                 AS table_name, 'clean_credited_through'
  UNION ALL SELECT 'notes'                  AS table_name, 'labels'
  UNION ALL SELECT 'notes'                  AS table_name, 'archived_at'
  UNION ALL SELECT 'food_entries'           AS table_name, 'meal_slot'
  UNION ALL SELECT 'food_entries'           AS table_name, 'sugar_g'
  UNION ALL SELECT 'food_entries'           AS table_name, 'sodium_mg'
  UNION ALL SELECT 'water_entries'          AS table_name, 'drink_type'
  UNION ALL SELECT 'family_pantry_items'    AS table_name, 'is_low'
  UNION ALL SELECT 'mentorship_requests'    AS table_name, 'agreement'
  UNION ALL SELECT 'circle_challenges'      AS table_name, 'metric'
  UNION ALL SELECT 'focus_sessions'         AS table_name, 'task_id'
  UNION ALL SELECT 'focus_sessions'         AS table_name, 'goal_id'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'repeat_interval'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'repeat_days'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'repeat_nth'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'repeat_count'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'notes'
  UNION ALL SELECT 'calendar_reminders'     AS table_name, 'notify_before2'
  UNION ALL SELECT 'notifications'          AS table_name, 'category'
  UNION ALL SELECT 'tasks'                  AS table_name, 'goal_id'
  UNION ALL SELECT 'note_edit_drafts'       AS table_name, 'labels'
  UNION ALL SELECT 'mentor_messages'        AS table_name, 'actions_json'
  UNION ALL SELECT 'reminder_dispatch_log'  AS table_name, 'snooze_of'
  UNION ALL SELECT 'reminder_dispatch_log'  AS table_name, 'attempts'
) AS t
LEFT JOIN information_schema.COLUMNS c
       ON c.table_schema = DATABASE()
      AND c.table_name   = t.table_name
      AND c.column_name  = t.column_name
ORDER BY status DESC, t.table_name, t.column_name;

-- ---- The ALTERs, newest last ----------------------------------------
ALTER TABLE habits ADD COLUMN color VARCHAR(16) NULL AFTER icon;
ALTER TABLE habits ADD COLUMN reminder_time TIME NULL AFTER cadence;
ALTER TABLE users ADD COLUMN whatsapp_number VARCHAR(20)    NULL;
ALTER TABLE users ADD COLUMN whatsapp_enabled BOOLEAN        NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN age_years INT            NULL;
ALTER TABLE users ADD COLUMN height_cm INT            NULL;
ALTER TABLE users ADD COLUMN weight_kg DECIMAL(5,1)   NULL;
ALTER TABLE users ADD COLUMN diet_preference VARCHAR(64)    NULL;
ALTER TABLE users ADD COLUMN about_me VARCHAR(500)   NULL;
ALTER TABLE users ADD COLUMN daily_food_goal_kcal INT        NULL;
ALTER TABLE users ADD COLUMN daily_water_goal_ml INT        NULL;
ALTER TABLE users ADD COLUMN gender VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN fitness_goal VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN whatsapp_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN favourite_dish VARCHAR(120) NULL;
ALTER TABLE users ADD COLUMN allergic_to VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN feature_prefs JSON         NULL;
ALTER TABLE users ADD COLUMN ui_prefs JSON         NULL;
ALTER TABLE family_members ADD COLUMN invite_only BOOLEAN NOT NULL DEFAULT FALSE AFTER status;
ALTER TABLE family_members ADD COLUMN height_cm INT NULL AFTER gender;
ALTER TABLE family_members ADD COLUMN weight_kg INT NULL AFTER height_cm;
ALTER TABLE mentorship_requests ADD COLUMN checked_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN nav_layout VARCHAR(255) NULL;
ALTER TABLE calendar_reminders ADD COLUMN sound VARCHAR(16) NULL;

-- Fitness habits: a habit can measure distance, steps or minutes, and a
-- check-in carries the number for that day.
ALTER TABLE habits ADD COLUMN metric VARCHAR(16) NOT NULL DEFAULT 'none';
ALTER TABLE habit_checkins ADD COLUMN metric_value DOUBLE NULL;
ALTER TABLE habit_checkins ADD COLUMN duration_min INT NULL;

-- Widening an ENUM: ddl-auto never does it, and MODIFY to the same definition
-- is a no-op. Safe to re-run; it keeps every existing value.
ALTER TABLE family_members
  MODIFY COLUMN status ENUM('unmapped','invited','mapped') NOT NULL DEFAULT 'unmapped';

ALTER TABLE habits ADD COLUMN sound VARCHAR(16) NULL;

-- Same widening as family_members.status above: adds 'reminder' (missing
-- since ReminderDeliveryScheduler shipped) and 'habit_reminder'.
ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('mentorship_request','mentorship_accepted',
    'mentorship_rejected','system','reminder','habit_reminder') NOT NULL;

-- A NEW TABLE, not a column: `tableCreationQueries.sql` is only ever run to
-- build a fresh database, so a table added after first release reaches nothing
-- that is already running — and the first query naming it does not 500, it
-- throws inside the scheduler tick and aborts every habit reminder in it.
-- Guarded, so re-running this file is a no-op. Keep it identical to the
-- CREATE TABLE over there.
CREATE TABLE IF NOT EXISTS `habit_reminder_dispatch_log` (
  `id` char(36) NOT NULL,
  `habit_id` char(36) NOT NULL,
  `occurrence_date` date NOT NULL,
  `channel` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_habit_dispatch_unique` (`habit_id`,`occurrence_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- channel is a '+'-joined list of what actually delivered, and once push
-- joined the bell and WhatsApp the widest value became 'app+whatsapp+push' —
-- 17 characters into varchar(16). The insert threw, so no dispatch-log row was
-- written, so the next tick saw nothing delivered and sent again: one reminder
-- arrived five or six times, once per tick of the 5-minute catch-up window.
-- Same widening as the ENUMs above: MODIFY to the definition already in place
-- is a no-op, so this is safe to re-run.
ALTER TABLE reminder_dispatch_log MODIFY COLUMN `channel` varchar(32) NOT NULL;

-- A NEW TABLE, so it needs to be here as well as in the schema file: prod runs
-- ddl-auto: none and only ever loads tableCreationQueries.sql into a fresh
-- database, so a table added after first release reaches nothing that is
-- already running. Guarded, so re-running this file is a no-op. Keep it
-- identical to the CREATE TABLE over there.
CREATE TABLE IF NOT EXISTS `custom_sounds` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `data_url` mediumtext NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_custom_sounds_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NEW TABLES for Money accounts (cash / bank) and for expenses moving out of the
-- money_state document. Guarded, so re-running is a no-op; keep them identical
-- to tableCreationQueries.sql. No data moves here: TiDB has no JSON_TABLE to
-- unpack the document with, so MoneyService.migrate() moves each user's old
-- expenses/income into money_transactions the first time they open Money.
-- Where money sits: cash in a purse, a bank account, a card, a UPI wallet.
-- balance = opening_balance + everything booked to the account since. Nothing
-- here stores a running total, so no write can ever leave it out of step.
CREATE TABLE IF NOT EXISTS `money_accounts` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(40) NOT NULL,
  `kind` varchar(10) NOT NULL,
  `opening_balance` decimal(14,2) NOT NULL DEFAULT 0,
  `position` int NOT NULL DEFAULT 0,
  `archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_macc_user_name` (`user_id`, `name`),
  KEY `ix_macc_user` (`user_id`, `position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every expense, income and transfer, one row each. It used to live inside the
-- money_state JSON document, which is re-sent whole on every edit and capped at
-- 512 kB (~3,000 expenses). The key leads with user_id, so a user's rows sit
-- together and every read below is a range scan inside one user, however large
-- the table grows. `id` is the client's own id (unique per user, not globally —
-- 'sub-<id>-<month>' is deterministic), which is what makes a retried write an
-- upsert instead of a duplicate.
CREATE TABLE IF NOT EXISTS `money_transactions` (
  `user_id` char(36) NOT NULL,
  `id` varchar(64) NOT NULL,
  `kind` varchar(10) NOT NULL,
  `account_id` char(36) DEFAULT NULL,
  `to_account_id` char(36) DEFAULT NULL,
  `amount` decimal(14,2) NOT NULL,
  `category` varchar(40) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `occurred_on` date NOT NULL,
  `extra` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`, `id`),
  KEY `ix_mtx_user_day` (`user_id`, `occurred_on`),
  KEY `ix_mtx_user_account` (`user_id`, `account_id`),
  KEY `ix_mtx_user_to_account` (`user_id`, `to_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The AI's summary of one day's spending, kept so a second tap on the same bar
-- costs nothing. Only the last 7 days are ever shown, so older rows are purged
-- nightly; a row is deleted the moment an expense on that day changes.
CREATE TABLE IF NOT EXISTS `money_day_summaries` (
  `user_id` char(36) NOT NULL,
  `day` date NOT NULL,
  `summary` text NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estimated protein per entry, for the Food summary's weekly protein report.
-- NULL until FoodWeek estimates it (in one batch, the first time that week is
-- viewed), so existing rows need nothing.
ALTER TABLE food_entries ADD COLUMN protein_g SMALLINT NULL;

-- Carbs, fat and fiber beside it, for the Summary's nutrition report. Same
-- deal: NULL until FoodWeek's batch fills all four at once.
ALTER TABLE food_entries ADD COLUMN carbs_g SMALLINT NULL;
ALTER TABLE food_entries ADD COLUMN fat_g SMALLINT NULL;
ALTER TABLE food_entries ADD COLUMN fiber_g SMALLINT NULL;

-- A note's cover thumbnail, so the Notes list can send it instead of every
-- photo in every note. NULL until the note is next saved with a photo.
ALTER TABLE notes ADD COLUMN cover TEXT NULL;

-- Which days of the month each user has a subscription due on (bit d-1 for day d),
-- so SubscriptionDueScheduler reads only the documents of users due around today
-- instead of every WhatsApp user's on every tick. NULL until the row's next save
-- or the scheduler's first pass over it fills it in, so existing rows need nothing.
ALTER TABLE money_state ADD COLUMN sub_due_days INT NULL;

-- A custom sound as raw bytes instead of a base64 data URL, a third smaller.
-- Nothing is converted here: CustomSoundService moves each old row over the
-- first time it is read, and new uploads write only these two columns.
ALTER TABLE custom_sounds ADD COLUMN content_type VARCHAR(64) NULL;
ALTER TABLE custom_sounds ADD COLUMN audio MEDIUMBLOB NULL;

-- How many times a task's due date was moved to a later day, so Insights can
-- ask "break it down or drop it?" about one that keeps getting pushed.
ALTER TABLE tasks ADD COLUMN push_count INT NOT NULL DEFAULT 0;

-- A reminder can be a time block ("Meeting 15:00-16:00"), so the calendar can
-- show a day's busy and free hours. NULL = a point reminder, as before.
ALTER TABLE calendar_reminders ADD COLUMN end_time_of_day TIME(6) NULL;

-- A task can be put on hold: kept, but not escalated to High when overdue.
ALTER TABLE tasks ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE;

-- The Money day summary is written from the facts now, with no AI, so its cache
-- table is unused. It only ever held regenerable text.
DROP TABLE IF EXISTS money_day_summaries;

-- Buddy's diet check, one row per user and scope ('week' or a YYYY-MM-DD of the
-- last 7 days), so a repeat check survives a restart without another AI call.
-- The row keeps the exact prompt it answered: a changed meal or water entry
-- changes the prompt, so a stale row is simply a miss and nothing has to delete
-- it. Rows older than 8 days are purged nightly (no day that old is checkable).
CREATE TABLE IF NOT EXISTS food_diet_checks (
  user_id         CHAR(36)     NOT NULL,
  scope           VARCHAR(10)  NOT NULL,
  prompt          TEXT         NOT NULL,
  answer          TEXT         NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, scope),
  CONSTRAINT fk_diet_check_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The Notes composer's draft, autosaved (one row per user; Save deletes it).
CREATE TABLE IF NOT EXISTS note_drafts (
  user_id       CHAR(36)     NOT NULL,
  title         VARCHAR(200) NULL,
  body          MEDIUMTEXT   NULL,
  color         VARCHAR(16)  NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_note_drafts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A user can keep up to four sounds of their own (uploads or voice recordings),
-- not one: each gets a name for the picker, and the one-per-user unique key
-- gives way to a plain index so lookups by user stay indexed. Add the index
-- BEFORE dropping the unique key. The two index lines are not in the check
-- above (it reads columns); see whether they are still needed with
--   SHOW INDEX FROM custom_sounds;
-- -- run the ADD if idx_custom_sounds_user is absent, the DROP if
-- uq_custom_sounds_user is still there. Neither touches a row.
ALTER TABLE custom_sounds ADD COLUMN name VARCHAR(60) NULL;
-- 'recording' or 'file': a sound can be renamed, so its kind can't be read off its name.
ALTER TABLE custom_sounds ADD COLUMN source VARCHAR(16) NULL;
ALTER TABLE custom_sounds ADD INDEX idx_custom_sounds_user (user_id);
ALTER TABLE custom_sounds DROP INDEX uq_custom_sounds_user;

-- A reminder can ring ahead of its time and be snoozed. notify_before is minutes
-- ahead of time_of_day (NULL = the user's default, ui_prefs.reminderLead);
-- snoozed_until is when a snoozed reminder rings again (NULL = not snoozed).
ALTER TABLE calendar_reminders ADD COLUMN notify_before INT NULL;
ALTER TABLE calendar_reminders ADD COLUMN snoozed_until DATETIME(6) NULL;

-- Private Growth Circles: unlisted, joined with a code. Existing circles get
-- the column default, 'public', which is what they already were.
ALTER TABLE circles ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'public';
ALTER TABLE circles ADD COLUMN join_code VARCHAR(12) NULL;

-- "We cooked this" bumps a plan's dishes once; cooked_at is the first tap.
ALTER TABLE family_meal_plans ADD COLUMN cooked_at DATETIME(6) NULL;

-- Buddy's canned replies (AI offline or unreachable) stay in the chat but are
-- left out of the history sent to the model. Existing rows: FALSE, as before.
ALTER TABLE mentor_messages ADD COLUMN fallback BOOLEAN NOT NULL DEFAULT FALSE;

-- Unsaved edits to an existing note (the composer's note_drafts only ever
-- covered a new one). A new table, so a guarded CREATE rather than an ALTER.
CREATE TABLE IF NOT EXISTS note_edit_drafts (
  note_id       CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  title         VARCHAR(200) NULL,
  body          MEDIUMTEXT   NULL,
  color         VARCHAR(16)  NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id),
  KEY ix_note_edit_drafts_user (user_id),
  CONSTRAINT fk_note_edit_drafts_note FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_edit_drafts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The user's own habit order (PUT /api/habits/order). Existing rows get 0, so
-- they keep their created_at order until the user first moves one.
ALTER TABLE habits ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

-- Notes: labels (comma-joined, NULL = none) and archive (NULL = in the main
-- list). Existing notes get NULL for both: unlabelled and not archived.
ALTER TABLE notes ADD COLUMN labels VARCHAR(500) NULL;
ALTER TABLE notes ADD COLUMN archived_at TIMESTAMP NULL;

-- Account deletion grace period: "delete my account" stamps this and revokes
-- every session; AccountDeletionJob purges 7 days later. Existing rows: NULL
-- (not scheduled).
ALTER TABLE users ADD COLUMN deletion_requested_at DATETIME(6) NULL;

-- Change email (code to the new address) and authenticator-app 2FA. New
-- tables, so guarded CREATEs rather than ALTERs; same as tableCreationQueries.sql.
CREATE TABLE IF NOT EXISTS email_change_tokens (
  token_hash       VARCHAR(255) NOT NULL,
  user_id          CHAR(36)     NOT NULL,
  new_email        VARCHAR(254) NOT NULL,
  expires_at       DATETIME(6)  NOT NULL,
  consumed_at      DATETIME(6)  NULL,
  PRIMARY KEY (token_hash),
  KEY ix_ect_user (user_id),
  CONSTRAINT fk_ect_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_totp (
  user_id          CHAR(36)     NOT NULL,
  secret_enc       VARCHAR(255) NOT NULL,
  enabled_at       DATETIME(6)  NULL,
  last_used_step   BIGINT       NULL,
  recovery_codes   JSON         NULL,
  created_at       DATETIME(6)  NOT NULL,
  updated_at       DATETIME(6)  NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_totp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meal slots (breakfast|lunch|dinner|snack). Existing rows stay NULL; the app
-- groups those by the hour they were logged at.
ALTER TABLE food_entries ADD COLUMN meal_slot VARCHAR(10) NULL;
-- Label figures from a barcode (OpenFoodFacts) only; NULL everywhere else.
ALTER TABLE food_entries ADD COLUMN sugar_g SMALLINT NULL;
ALTER TABLE food_entries ADD COLUMN sodium_mg INT NULL;
-- What a glass was (tea, coffee, ...); NULL is water, as every existing row is.
ALTER TABLE water_entries ADD COLUMN drink_type VARCHAR(10) NULL;

-- Starred foods. A new table, so a guarded CREATE rather than an ALTER.
CREATE TABLE IF NOT EXISTS food_favourites (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  food_name       VARCHAR(255) NOT NULL,
  quantity_grams  INT          NOT NULL,
  kcal            INT          NOT NULL,
  protein_g       SMALLINT     NULL,
  carbs_g         SMALLINT     NULL,
  fat_g           SMALLINT     NULL,
  fiber_g         SMALLINT     NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_food_fav_user (user_id),
  CONSTRAINT fk_food_fav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Richer reminder recurrence (every N, chosen weekdays, nth weekday, end after
-- N times), notes, and a second alert. Existing rows: interval 1 and NULLs,
-- which is exactly what they meant before.
ALTER TABLE calendar_reminders ADD COLUMN repeat_interval INT NOT NULL DEFAULT 1;
ALTER TABLE calendar_reminders ADD COLUMN repeat_days VARCHAR(32) NULL;
ALTER TABLE calendar_reminders ADD COLUMN repeat_nth INT NULL;
ALTER TABLE calendar_reminders ADD COLUMN repeat_count INT NULL;
ALTER TABLE calendar_reminders ADD COLUMN notes VARCHAR(1000) NULL;
ALTER TABLE calendar_reminders ADD COLUMN notify_before2 INT NULL;

-- A reminder's occurrences checked off (POST /api/reminders/{id}/done). A new
-- table, so a guarded CREATE rather than an ALTER.
CREATE TABLE IF NOT EXISTS reminder_done (
  id              CHAR(36)    NOT NULL,
  reminder_id     CHAR(36)    NOT NULL,
  user_id         CHAR(36)    NOT NULL,
  occurrence_date DATE        NOT NULL,
  done_at         DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_reminder_done (reminder_id, occurrence_date),
  KEY ix_reminder_done_user (user_id, occurrence_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mentorship: the pair's agreement (weekly check-in card). Existing links: NULL.
ALTER TABLE mentorship_requests ADD COLUMN agreement VARCHAR(500) NULL;
-- Circle challenges count something other than habit check-ins. Existing
-- challenges get the default, which is what they already counted.
ALTER TABLE circle_challenges ADD COLUMN metric VARCHAR(16) NOT NULL DEFAULT 'habit_checkins';

-- Mentor <-> mentee thread (messages + cheers/nudges) and circle post kudos.
-- New tables, so guarded CREATEs; same as tableCreationQueries.sql.
CREATE TABLE IF NOT EXISTS mentorship_messages (
  id            CHAR(36)      NOT NULL,
  link_id       CHAR(36)      NOT NULL,
  sender_id     CHAR(36)      NOT NULL,
  kind          VARCHAR(8)    NOT NULL DEFAULT 'message',
  body          VARCHAR(2000) NULL,
  created_at    DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_mm_link_time (link_id, created_at),
  CONSTRAINT fk_mm_link   FOREIGN KEY (link_id)   REFERENCES mentorship_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_mm_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS circle_post_reactions (
  post_id         CHAR(36)    NOT NULL,
  user_id         CHAR(36)    NOT NULL,
  created_at      DATETIME(6) NOT NULL,
  PRIMARY KEY (post_id, user_id),
  KEY ix_circle_post_reaction_user (user_id),
  CONSTRAINT fk_cpr_post FOREIGN KEY (post_id) REFERENCES circle_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cpr_user FOREIGN KEY (user_id) REFERENCES users(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pantry "running low" flag (Pantry -> "Add expiring & low items to list").
-- Existing rows: 0, not low.
ALTER TABLE family_pantry_items ADD COLUMN is_low BIT(1) NOT NULL DEFAULT b'0';

-- Household chores and per-dish recipes. New tables, so guarded CREATEs
-- rather than ALTERs; same as tableCreationQueries.sql. Both are family-owned:
-- AuthService.FAMILY_OWNED_TABLES deletes them with the family.
CREATE TABLE IF NOT EXISTS `family_chores` (
  `id` char(36) NOT NULL,
  `family_id` char(36) NOT NULL,
  `title` varchar(120) NOT NULL,
  `assignee_member_id` char(36) DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `repeat_rule` varchar(8) NOT NULL DEFAULT 'none',
  `done_at` datetime(6) DEFAULT NULL,
  `created_by_user_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_chores_family` (`family_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `family_recipes` (
  `id` char(36) NOT NULL,
  `family_id` char(36) NOT NULL,
  `dish_key` varchar(160) NOT NULL,
  `dish_name` varchar(160) NOT NULL,
  `ingredients` text,
  `steps` text,
  `cook_minutes` int DEFAULT NULL,
  `updated_by_user_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_family_recipe` (`family_id`,`dish_key`),
  KEY `ix_family_recipes_family` (`family_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

-- A task can belong to one of the user's goals (Goals: "Tasks: done/total").
-- NULL = no goal, as every existing task. Deleting the goal sets it back to NULL.
ALTER TABLE tasks ADD COLUMN goal_id CHAR(36) NULL;

-- "Break a habit": a habit is build (tick to do it) or quit (clean unless a
-- slip is logged). Existing rows get 'build', which is what every habit was.
-- clean_credited_through: the last day a quit habit's clean days were paid XP.
ALTER TABLE habits ADD COLUMN kind VARCHAR(8) NOT NULL DEFAULT 'build';
ALTER TABLE habits ADD COLUMN clean_credited_through DATE NULL;

-- A focus session linked to what it was spent on (the timer's "Focusing on…").
-- Existing rows: NULL, a session on nothing in particular.
ALTER TABLE focus_sessions ADD COLUMN task_id CHAR(36) NULL;
ALTER TABLE focus_sessions ADD COLUMN goal_id CHAR(36) NULL;

-- The bell's filter chips and the per-category push mute (NotifyCategory).
-- Nullable: an existing row reads its category off its kind.
ALTER TABLE notifications ADD COLUMN category VARCHAR(16) NULL;

-- An open note edit's autosave keeps its label chips too (comma-joined like
-- notes.labels). NULL: a draft from before, which restores without touching labels.
ALTER TABLE note_edit_drafts ADD COLUMN labels VARCHAR(500) NULL;

-- Buddy's one-tap actions ("Add as task" / "Make it a habit" / "Remind me"):
-- the JSON the model offered with a reply, stripped from its text. NULL = none.
ALTER TABLE mentor_messages ADD COLUMN actions_json TEXT NULL;

-- Buddy's evening reflection prompt (ReflectionScheduler). Widening the ENUM
-- keeps every existing value; MODIFY to the definition already in place is a
-- no-op, so this is safe to re-run.
ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('mentorship_request','mentorship_accepted',
    'mentorship_rejected','system','reminder','habit_reminder','buddy_checkin') NOT NULL;

-- Idempotency-Key replay cache (an offline replay is answered, not run twice).
-- A new table, so a guarded CREATE; same as tableCreationQueries.sql.
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `user_id` char(36) NOT NULL,
  `idem_key` varchar(64) NOT NULL,
  `method` varchar(8) NOT NULL,
  `path` varchar(255) NOT NULL,
  `status` int DEFAULT NULL,
  `content_type` varchar(255) DEFAULT NULL,
  `response_body` mediumtext,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`,`idem_key`),
  KEY `ix_idempotency_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

-- A snooze is claimed with a 'pending' dispatch-log row and rung again by the
-- sweeper if its instance dies before marking it 'sent' (ReminderDeliveryScheduler
-- .resendStuckSnoozes). snooze_of: the reminder a snooze row rings (NULL on an
-- occurrence's row); attempts: sends tried, existing rows 0.
ALTER TABLE reminder_dispatch_log ADD COLUMN snooze_of CHAR(36) NULL;
ALTER TABLE reminder_dispatch_log ADD COLUMN attempts INT NOT NULL DEFAULT 0;

-- The index tableCreationQueries.sql declares with tasks.goal_id (KEY
-- ix_tasks_goal), missing from a database that got the column from the ALTER
-- above. Guarded through information_schema, so it is safe to re-run on MySQL
-- and TiDB alike; it touches no row.
SET @gb_ix := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE tasks ADD INDEX ix_tasks_goal (goal_id)', 'SELECT 1')
               FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'ix_tasks_goal');
PREPARE gb_stmt FROM @gb_ix;
EXECUTE gb_stmt;
DEALLOCATE PREPARE gb_stmt;
