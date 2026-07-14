
-- =========================================================
-- Growth Buddy — Database Schema
-- MySQL 8.0+
-- =========================================================

-- Use utf8mb4 across the board for emoji + full Unicode support.
-- Run this DB-creation line yourself if needed:
CREATE DATABASE growth_buddy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE growth_buddy;

-- =========================================================
-- USERS
-- =========================================================
CREATE TABLE users (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  email           VARCHAR(254) NOT NULL,
  email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  display_name    VARCHAR(120) NOT NULL,
  avatar_url      TEXT,
  timezone        VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  dob             DATE         NULL,
  level           INT          NOT NULL DEFAULT 1,        -- derived from xp_events, cached
  xp_total       INT          NOT NULL DEFAULT 0,        -- derived, cached
  digest_frequency VARCHAR(16) NOT NULL DEFAULT 'off',    -- off | daily | weekly progress digest
  digest_hour     INT          NOT NULL DEFAULT 8,        -- local hour (0-23) to send the digest
  last_digest_on  DATE         NULL,                      -- guards one digest per local day
  home_layout     JSON         NULL,                      -- ordered home widgets [{id,enabled}] (null = default)
  nav_layout      JSON         NULL,                      -- ordered bottom-nav [{id,primary}] (null = default)
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_preferences (
  user_id         BINARY(16)     NOT NULL,
  theme           ENUM('light','dark') NOT NULL DEFAULT 'light',
  daily_reminder  TIME         NULL,
  notifications   JSON         NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- AUTH
-- =========================================================
CREATE TABLE auth_identities (
  id               BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id          BINARY(16)     NOT NULL,
  provider         ENUM('password','google','apple','github') NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,                 -- 'sub' from OIDC, or email for password
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_identity (provider, provider_user_id),
  KEY ix_auth_identity_user (user_id),
  CONSTRAINT fk_auth_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_credentials (
  user_id          BINARY(16)     NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,                 -- argon2id recommended
  algo             VARCHAR(32)  NOT NULL DEFAULT 'argon2id',
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_pw_creds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id                  BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id             BINARY(16)     NOT NULL,
  refresh_token_hash  VARCHAR(255) NOT NULL,              -- store hash, not the token
  user_agent          TEXT,
  ip                  VARCHAR(45),                        -- IPv4 or IPv6
  device_label        VARCHAR(120),
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMP    NOT NULL,
  revoked_at          TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_refresh (refresh_token_hash),
  KEY ix_session_user_expires (user_id, expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_verification_tokens (
  token_hash       VARCHAR(255) NOT NULL,
  user_id          BINARY(16)     NOT NULL,
  expires_at       TIMESTAMP    NOT NULL,
  consumed_at      TIMESTAMP    NULL,
  PRIMARY KEY (token_hash),
  KEY ix_evt_user (user_id),
  CONSTRAINT fk_evt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_reset_tokens (
  token_hash       VARCHAR(255) NOT NULL,
  user_id          BINARY(16)     NOT NULL,
  expires_at       TIMESTAMP    NOT NULL,
  consumed_at      TIMESTAMP    NULL,
  PRIMARY KEY (token_hash),
  KEY ix_prt_user (user_id),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- TASKS  (+ recurrence)
-- =========================================================
-- A recurring task is a template; instances live in `tasks` with `template_id` set.
CREATE TABLE task_templates (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  title           VARCHAR(255) NOT NULL,
  notes           TEXT,
  priority        ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  default_time    TIME         NULL,                      -- e.g. 21:00 for "9:00 PM"
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_task_template_user (user_id),
  CONSTRAINT fk_task_template_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recurrences (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  owner_type      ENUM('task_template','habit') NOT NULL,
  owner_id        BINARY(16)     NOT NULL,
  freq            ENUM('daily','weekly','monthly','yearly') NOT NULL,
  `interval`      INT          NOT NULL DEFAULT 1,        -- every N units; backticked (reserved word)
  by_weekday      JSON         NULL,                      -- e.g. [1,3,5]  (0=Sun..6=Sat)
  by_month_day    JSON         NULL,                      -- e.g. [1,15]
  start_date      DATE         NOT NULL,
  end_date        DATE         NULL,
  occurrence_cap  INT          NULL,                      -- optional max occurrences (was "count")
  PRIMARY KEY (id),
  UNIQUE KEY uq_recurrence_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  template_id     BINARY(16)     NULL,
  title           VARCHAR(255) NOT NULL,
  notes           TEXT,
  priority        ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  due_at          TIMESTAMP    NULL,
  done            BOOLEAN      NOT NULL DEFAULT FALSE,
  done_at         TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_tasks_user_due (user_id, due_at),
  KEY ix_tasks_user_done (user_id, done),
  KEY ix_tasks_template (template_id),
  CONSTRAINT fk_tasks_user     FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_template FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_completion_history (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  task_id         BINARY(16)     NOT NULL,
  changed_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  priority        ENUM('Low','Medium','High') NOT NULL,
  due_at          TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_task_hist_user_task_time (user_id, task_id, changed_at),
  CONSTRAINT fk_task_hist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_hist_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- HABITS  (recurrence lives in `recurrences` with owner_type='habit')
-- =========================================================
CREATE TABLE habits (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  name            VARCHAR(120) NOT NULL,
  domain          ENUM('habit','fitness','study','journal') NOT NULL DEFAULT 'habit',
  icon            VARCHAR(64)  NOT NULL,
  cadence         ENUM('daily','weekly','custom') NOT NULL DEFAULT 'daily',
  target_per_week INT          NOT NULL DEFAULT 7,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_habits_user (user_id),
  CONSTRAINT fk_habits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE habit_checkins (
  habit_id        BINARY(16)     NOT NULL,
  user_id         BINARY(16)     NOT NULL,
  log_date        DATE         NOT NULL,                  -- in user's local TZ at write time
  done            BOOLEAN      NOT NULL DEFAULT TRUE,
  protected_day   BOOLEAN      NOT NULL DEFAULT FALSE,     -- rest/freeze day: bridges the streak gap
  note            TEXT,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (habit_id, log_date),
  KEY ix_habit_checkin_user_date (user_id, log_date),
  CONSTRAINT fk_habit_checkin_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
  CONSTRAINT fk_habit_checkin_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE habit_streaks (
  habit_id        BINARY(16) NOT NULL,
  current_streak  INT      NOT NULL DEFAULT 0,
  longest_streak  INT      NOT NULL DEFAULT 0,
  last_done_on    DATE     NULL,
  PRIMARY KEY (habit_id),
  CONSTRAINT fk_habit_streak_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One freeze token granted per ISO week (Monday-anchored), capped; spent to
-- protect a habit day (planned rest or rescue of a missed day).
CREATE TABLE streak_freeze_wallets (
  user_id     BINARY(16) NOT NULL,
  tokens      INT      NOT NULL DEFAULT 1,
  week_anchor DATE     NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_freeze_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- WATER TRACKER
-- =========================================================
CREATE TABLE water_goals (
  user_id         BINARY(16) NOT NULL,
  goal_ml         INT      NOT NULL DEFAULT 2000,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_water_goal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_water_goal_range CHECK (goal_ml BETWEEN 250 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE water_entries (
  id              BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)  NOT NULL,
  amount_ml       INT       NOT NULL,
  note            VARCHAR(255) NULL,
  logged_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  log_date        DATE      NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_water_entry_user_date (user_id, log_date),
  KEY ix_water_entry_user_time (user_id, logged_at),
  CONSTRAINT fk_water_entry_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_water_amount_range CHECK (amount_ml BETWEEN 1 AND 5000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- FOOD CALORIE TRACKER
-- =========================================================
CREATE TABLE food_entries (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  food_name       VARCHAR(255) NOT NULL,
  quantity_grams  INT          NOT NULL,
  meal_type       ENUM('home','hotel') NOT NULL DEFAULT 'home',
  kcal_estimated  INT          NOT NULL,
  kcal_per_100g   INT          NOT NULL,
  estimate_source VARCHAR(20)  NOT NULL,
  note            VARCHAR(255) NULL,
  logged_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  log_date        DATE         NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_food_entry_user_date (user_id, log_date),
  KEY ix_food_entry_user_time (user_id, logged_at),
  CONSTRAINT fk_food_entry_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_food_qty_range CHECK (quantity_grams BETWEEN 10 AND 2000),
  CONSTRAINT ck_food_kcal_range CHECK (kcal_estimated BETWEEN 1 AND 5000),
  CONSTRAINT ck_food_kcal_100g_range CHECK (kcal_per_100g BETWEEN 40 AND 900)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recent food-photo analyses (the "recent scans" list); capped to 12 per user
-- on read.
CREATE TABLE food_photo_logs (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  log_date        DATE         NOT NULL,
  food_name       VARCHAR(255) NOT NULL,
  meal_type       VARCHAR(32)  NULL,
  confidence      INT          NULL,
  fallback_needed BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_food_photo_user_time (user_id, created_at),
  CONSTRAINT fk_food_photo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- GOALS
-- =========================================================
CREATE TABLE goals (
  id              BINARY(16)   NOT NULL,
  user_id         BINARY(16)   NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  horizon         ENUM('short_term','mid_term','long_term') NOT NULL DEFAULT 'short_term',
  target_date     DATE         NULL,
  completed       BOOLEAN      NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMP    NULL,
  progress_json   TEXT         NULL,   -- opaque frontend progress blob (milestones, day-tracker)
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_goal_user_horizon (user_id, horizon),
  KEY ix_goal_user_completed (user_id, completed),
  CONSTRAINT fk_goal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE goal_actions (
  id              BINARY(16)   NOT NULL,
  goal_id         BINARY(16)   NOT NULL,
  user_id         BINARY(16)   NOT NULL,
  note            VARCHAR(1000) NOT NULL,
  action_date     DATE         NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_goal_action_goal_time (goal_id, created_at),
  KEY ix_goal_action_user_time (user_id, created_at),
  CONSTRAINT fk_goal_action_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_action_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE gratitude_entries (
  id              BINARY(16)    NOT NULL,
  user_id         BINARY(16)    NOT NULL,
  note            VARCHAR(1000) NOT NULL,
  entry_date      DATE          NOT NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_gratitude_user_date (user_id, entry_date),
  CONSTRAINT fk_gratitude_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- FITNESS / WORKOUTS
-- =========================================================
CREATE TABLE workouts (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  title           VARCHAR(255) NOT NULL,
  scheduled_for   DATE         NOT NULL,
  duration_min    INT          NULL,
  progress_pct    INT          NOT NULL DEFAULT 0,
  completed_at    TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_workouts_user_date (user_id, scheduled_for),
  CONSTRAINT fk_workouts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_workouts_progress CHECK (progress_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workout_exercises (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  workout_id      BINARY(16)     NOT NULL,
  name            VARCHAR(120) NOT NULL,
  sets            INT          NULL,
  reps            INT          NULL,
  weight_kg       DECIMAL(6,2) NULL,
  position        INT          NOT NULL,
  PRIMARY KEY (id),
  KEY ix_workout_exercise_workout (workout_id),
  CONSTRAINT fk_workout_exercise_workout FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- JOURNAL
-- =========================================================
CREATE TABLE journal_entries (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  entry_date      DATE         NOT NULL,
  mood            TINYINT      NULL,
  body            TEXT         NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_journal_user_date (user_id, entry_date),
  CONSTRAINT fk_journal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_journal_mood CHECK (mood IS NULL OR mood BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- DAILY SCORE
-- =========================================================
CREATE TABLE daily_scores (
  user_id         BINARY(16) NOT NULL,
  score_date      DATE     NOT NULL,
  score           INT      NOT NULL,
  tasks_done      INT      NOT NULL DEFAULT 0,
  tasks_total     INT      NOT NULL DEFAULT 0,
  habits_done     INT      NOT NULL DEFAULT 0,
  habits_total    INT      NOT NULL DEFAULT 0,
  workout_done    BOOLEAN  NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, score_date),
  CONSTRAINT fk_daily_score_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_daily_score_range CHECK (score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-day wellness check-ins (sleep + mood) and a snapshot of headline metrics
-- (score / water / calories). Backs the Report trends + insights engine; every
-- column is nullable so a row may hold any subset.
CREATE TABLE daily_logs (
  user_id        BINARY(16) NOT NULL,
  log_date       DATE     NOT NULL,
  bedtime        VARCHAR(5),
  wake_time      VARCHAR(5),
  sleep_quality  VARCHAR(16),
  sleep_note     TEXT,
  mood           VARCHAR(16),
  energy         VARCHAR(16),
  stress         VARCHAR(16),
  mood_note      TEXT,
  score          INT,
  water_ml       INT,
  water_goal_ml  INT,
  kcal           INT,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, log_date),
  CONSTRAINT fk_daily_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- QUOTES
-- =========================================================
CREATE TABLE quotes (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  body            TEXT         NOT NULL,
  author          VARCHAR(120) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- MENTOR
-- =========================================================
CREATE TABLE mentor_threads (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  title           VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mentor_thread_user (user_id),
  CONSTRAINT fk_mentor_thread_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mentor_messages (
  id              BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  thread_id       BINARY(16)  NOT NULL,
  role            ENUM('user','assistant','system') NOT NULL,
  content         MEDIUMTEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mentor_msg_thread_time (thread_id, created_at),
  CONSTRAINT fk_mentor_msg_thread FOREIGN KEY (thread_id) REFERENCES mentor_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- GROWTH CIRCLES
-- =========================================================
CREATE TABLE circles (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  name            VARCHAR(120) NOT NULL,
  goal            TEXT         NULL,
  created_by      BINARY(16)     NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_circles_created_by (created_by),
  CONSTRAINT fk_circles_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE circle_members (
  circle_id       BINARY(16) NOT NULL,
  user_id         BINARY(16) NOT NULL,
  role            ENUM('owner','member') NOT NULL DEFAULT 'member',
  joined_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (circle_id, user_id),
  KEY ix_circle_member_user (user_id),
  CONSTRAINT fk_circle_member_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_member_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE circle_posts (
  id              BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  circle_id       BINARY(16)  NOT NULL,
  user_id         BINARY(16)  NOT NULL,
  body            TEXT      NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_circle_post_circle_time (circle_id, created_at DESC),
  KEY ix_circle_post_user (user_id),
  CONSTRAINT fk_circle_post_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_post_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Time-boxed habit challenges for a circle; members are ranked by check-ins
-- completed during [start_date, end_date].
CREATE TABLE circle_challenges (
  id              BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  circle_id       BINARY(16)  NOT NULL,
  title           VARCHAR(120) NOT NULL,
  start_date      DATE      NOT NULL,
  end_date        DATE      NOT NULL,
  created_by      BINARY(16)  NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_circle_challenge_circle (circle_id),
  CONSTRAINT fk_circle_challenge_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_challenge_user   FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- REMINDERS / PUSH
-- =========================================================
CREATE TABLE device_tokens (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  platform        ENUM('ios','android','web') NOT NULL,
  token           VARCHAR(512) NOT NULL,
  last_seen_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at      TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_token (platform, token),
  KEY ix_device_token_user (user_id),
  CONSTRAINT fk_device_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reminders (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)     NOT NULL,
  entity_type     ENUM('task','habit','workout','journal','custom') NOT NULL,
  entity_id       BINARY(16)     NULL,                       -- nullable for 'custom'
  title           VARCHAR(255) NOT NULL,
  body            TEXT         NULL,
  fire_at         TIMESTAMP    NOT NULL,
  status          ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  sent_at         TIMESTAMP    NULL,
  error           TEXT         NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_reminders_status_fire (status, fire_at),
  KEY ix_reminders_user_fire (user_id, fire_at),
  CONSTRAINT fk_reminders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- XP EVENTS  (append-only ledger; users.xp_total/level are caches)
-- =========================================================
CREATE TABLE xp_events (
  id              BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id         BINARY(16)  NOT NULL,
  source          ENUM(
                    'task_done','habit_checkin','habit_streak_bonus',
                    'workout_done','journal_entry','circle_post','achievement','admin_adjust'
                  ) NOT NULL,
  delta           INT       NOT NULL,                      -- positive or negative
  ref_type        VARCHAR(32) NULL,                        -- e.g. 'task','habit','workout'
  ref_id          BINARY(16)  NULL,
  occurred_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata        JSON      NOT NULL,
  PRIMARY KEY (id),
  KEY ix_xp_user_time (user_id, occurred_at),
  KEY ix_xp_ref (ref_type, ref_id),
  -- Idempotency: prevent double-awarding XP for the same action.
  -- NULL ref_id rows are allowed to repeat (MySQL treats NULLs as distinct in UNIQUE).
  UNIQUE KEY uq_xp_award (user_id, source, ref_type, ref_id),
  CONSTRAINT fk_xp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- v2 additions: customisable habits, notifications bell, mentorship invites
-- =====================================================================

-- Habits customisation: per-habit color + time-of-day reminder.
-- These ALTERs are idempotent-ish: re-running them on a fresh schema is fine,
-- and on an already-migrated DB MySQL will error harmlessly (run via the
-- "Migrations" section below to apply just the missing parts).
--
-- ALTER TABLE habits
--   ADD COLUMN color VARCHAR(16) NULL AFTER icon,
--   ADD COLUMN reminder_time TIME NULL AFTER cadence;

-- Bell-style notifications. One row per item, with a "kind" so the UI
-- can format / route differently (e.g. mentorship requests show Accept/Reject).
CREATE TABLE IF NOT EXISTS notifications (
  id          BINARY(16)  NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  user_id     BINARY(16)  NOT NULL,
  kind        ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','system') NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT          NULL,
  -- Optional pointer to whatever the notification is "about"
  -- (e.g. the mentorship_requests.id).
  related_id  BINARY(16)      NULL,
  read_at     TIMESTAMP     NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mentorship pairing requests.
--   direction = 'offer'   → from_user offers to mentor to_user
--   direction = 'request' → from_user asks to_user to be their mentor
-- The recipient sees a notification with Accept / Reject.
CREATE TABLE IF NOT EXISTS mentorship_requests (
  id            BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  from_user_id  BINARY(16) NOT NULL,
  to_user_id    BINARY(16) NOT NULL,
  direction     ENUM('offer','request') NOT NULL,
  status        ENUM('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
  note          VARCHAR(500) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  TIMESTAMP NULL,
  PRIMARY KEY (id),
  -- Don't put a unique key on (from, to, direction, status) — a 2nd
  -- accepted row legitimately shares that tuple once the pair has worked
  -- together twice. We enforce "one pending per direction" in code.
  KEY ix_mr_to_status   (to_user_id,   status, created_at),
  KEY ix_mr_from_status (from_user_id, status, created_at),
  CONSTRAINT fk_mr_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_to   FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- Migrations (run once per environment that already has v1 schema).
-- Wrap each ALTER in its own statement so a re-run that errors on the
-- duplicate column doesn't abort the whole script.
-- =====================================================================

-- Habit customisation columns (v2)
ALTER TABLE habits ADD COLUMN color VARCHAR(16) NULL AFTER icon;
ALTER TABLE habits ADD COLUMN reminder_time TIME NULL AFTER cadence;

-- User profile & nutrition columns (v2)
-- These are auto-applied at startup by Hibernate ddl-auto: update,
-- but listed here for fresh installs and documentation.
ALTER TABLE users ADD COLUMN whatsapp_number  VARCHAR(20)    NULL;
ALTER TABLE users ADD COLUMN whatsapp_enabled BOOLEAN        NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN age_years        INT            NULL;
ALTER TABLE users ADD COLUMN height_cm        INT            NULL;
ALTER TABLE users ADD COLUMN weight_kg        DECIMAL(5,1)   NULL;
ALTER TABLE users ADD COLUMN diet_preference  VARCHAR(64)    NULL;
ALTER TABLE users ADD COLUMN about_me         VARCHAR(500)   NULL;
ALTER TABLE users ADD COLUMN daily_food_goal_kcal INT        NULL;
ALTER TABLE users ADD COLUMN daily_water_goal_ml  INT        NULL;
ALTER TABLE users ADD COLUMN gender               VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN fitness_goal         VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN whatsapp_verified    BOOLEAN NOT NULL DEFAULT FALSE;

-- Customizable bottom-navigation layout (v4). Mirrors home_layout: a per-user
-- JSON array [{"id":"home","primary":true}, ...] where order is display order
-- and `primary` puts a destination in the bar (true) vs the "More" sheet.
-- ddl-auto: update auto-adds this nullable column; listed for fresh installs.
ALTER TABLE users ADD COLUMN nav_layout JSON NULL;

CREATE TABLE IF NOT EXISTS whatsapp_otp_tokens (
  token_hash  VARCHAR(255) NOT NULL,
  user_id     BINARY(16)     NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  expires_at  DATETIME(6)  NOT NULL,
  consumed_at DATETIME(6)  NULL,
  PRIMARY KEY (token_hash),
  KEY idx_wa_otp_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Drop stale unique index if it exists from an earlier schema version
-- ALTER TABLE mentorship_requests DROP INDEX uq_mr_pending;

-- =====================================================================
-- FAMILY (Family tab & AI South Indian meal planner) — v3
-- Auto-created at startup by Hibernate ddl-auto: update; listed here for
-- fresh installs and documentation. A household is a shared graph: multiple
-- accounts resolve into the same family via family_members.linked_user_id.
-- =====================================================================
CREATE TABLE IF NOT EXISTS families (
  id              BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  owner_user_id   BINARY(16)     NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_family_owner (owner_user_id),
  CONSTRAINT fk_family_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS family_members (
  id                    BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  family_id             BINARY(16)     NOT NULL,
  linked_user_id        BINARY(16)     NULL,
  name                  VARCHAR(120) NOT NULL,
  relationship          VARCHAR(16)  NOT NULL DEFAULT 'other',
  dob                   DATE         NULL,
  gender                VARCHAR(20)  NULL,
  status                VARCHAR(12)  NOT NULL DEFAULT 'unmapped',
  favourite_dishes      TEXT         NULL,
  favourite_ingredients TEXT         NULL,
  diet_preference       VARCHAR(32)  NULL,
  allergies             TEXT         NULL,
  ingredients_to_avoid  TEXT         NULL,
  medical_conditions    TEXT         NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP    NULL,
  PRIMARY KEY (id),
  KEY ix_family_member_family (family_id),
  KEY ix_family_member_linked (linked_user_id),
  CONSTRAINT fk_family_member_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  CONSTRAINT fk_family_member_user FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS family_meal_plans (
  id                   BINARY(16)     NOT NULL DEFAULT (UUID_TO_BIN(UUID())),
  family_id            BINARY(16)     NOT NULL,
  plan_json            TEXT         NOT NULL,
  grocery_items_json   TEXT         NULL,
  generated_by_user_id BINARY(16)     NOT NULL,
  source               VARCHAR(24)  NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_family_meal_plan_family (family_id, created_at),
  CONSTRAINT fk_family_meal_plan_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Family invitations consent handshake (v3.1): a registered member starts as
-- 'invited' (pending) and must accept before joining the shared family.
-- ddl-auto: update will NOT widen an existing ENUM, so run this once.
ALTER TABLE family_members
  MODIFY COLUMN status ENUM('unmapped','invited','mapped') NOT NULL DEFAULT 'unmapped';

-- Family invite-only flag (v3.2): rows created solely to carry an invite are
-- removed (not orphaned) when the invitee declines. Run once.
ALTER TABLE family_members ADD COLUMN invite_only BOOLEAN NOT NULL DEFAULT FALSE AFTER status;

-- Family member physique (v3.3): height/weight for nutrition tailoring.
-- ddl-auto: update auto-adds these nullable columns; listed for fresh installs.
ALTER TABLE family_members ADD COLUMN height_cm INT NULL AFTER gender;
ALTER TABLE family_members ADD COLUMN weight_kg INT NULL AFTER height_cm;

-- =========================================================
-- MONEY BUDDY  (v4)
-- The whole money state (expenses, budgets, savings goals, custom tags,
-- challenges, wishlist, subscriptions, reflections, settings) is stored as one
-- per-user JSON document. All insights/health-score/search/etc. are computed
-- client-side, so there is no server-side query that would need normalized
-- tables. ddl-auto: update creates this automatically; listed for fresh installs.
-- =========================================================
CREATE TABLE money_state (
  user_id    BINARY(16)  NOT NULL,
  data       JSON      NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_money_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- GOOGLE CALENDAR LINKS  (v5)
-- One row per user who connected Google Calendar (read-only). Stores the
-- OAuth refresh token; access tokens are minted on demand and never persisted.
-- ddl-auto: update creates this automatically; listed for fresh installs.
-- =========================================================
CREATE TABLE google_calendar_links (
  user_id       BINARY(16)   NOT NULL,
  google_email  VARCHAR(254) NULL,
  refresh_token VARCHAR(512) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_gcal_link_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Google OAuth client for Calendar sync (v5.1): entered once from Settings ->
-- Integrations instead of env vars. Single row (id = 1); GOOGLE_CLIENT_ID /
-- GOOGLE_CLIENT_SECRET env vars remain the fallback when this table is empty.
-- ddl-auto: update creates this automatically; listed for fresh installs.
CREATE TABLE google_oauth_settings (
  id            INT          NOT NULL,
  client_id     VARCHAR(200) NOT NULL,
  client_secret VARCHAR(200) NOT NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
