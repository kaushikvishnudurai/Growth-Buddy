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
