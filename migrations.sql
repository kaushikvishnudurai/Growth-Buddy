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
