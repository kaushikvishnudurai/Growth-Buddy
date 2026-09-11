-- MySQL dump 10.13  Distrib 9.7.0, for macos15 (arm64)
--
-- Host: localhost    Database: growth_buddy
-- ------------------------------------------------------
-- Server version	9.7.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '09ca6014-4bb0-11f1-9f2f-d1563e3240ad:1-1584780';

--
-- Table structure for table `calendar_reminder_skips`
--
CREATE DATABASE IF NOT EXISTS `growth_buddy` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */;

DROP TABLE IF EXISTS `calendar_reminder_skips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_reminder_skips` (
  `reminder_id` varchar(36) NOT NULL,
  `skip_date` date NOT NULL,
  PRIMARY KEY (`reminder_id`,`skip_date`),
  CONSTRAINT `FK3fhfwht79vx2f490y2wxnsaeb` FOREIGN KEY (`reminder_id`) REFERENCES `calendar_reminders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `calendar_reminders`
--

DROP TABLE IF EXISTS `calendar_reminders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_reminders` (
  `id` varchar(36) NOT NULL,
  `anchor_date` date NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `from_date` date DEFAULT NULL,
  `repeat_freq` varchar(16) NOT NULL,
  `tag` varchar(16) NOT NULL,
  `text` varchar(255) NOT NULL,
  `time_of_day` time(6) DEFAULT NULL,
  `until_date` date DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_cal_rem_user_date` (`user_id`,`anchor_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `circle_challenges`
--

DROP TABLE IF EXISTS `circle_challenges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `circle_challenges` (
  `id` char(36) NOT NULL,
  `circle_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `created_by` char(36) NOT NULL,
  `end_date` date NOT NULL,
  `start_date` date NOT NULL,
  `title` varchar(120) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_circle_challenge_circle` (`circle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `circle_members`
--

DROP TABLE IF EXISTS `circle_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `circle_members` (
  `circle_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `joined_at` datetime(6) NOT NULL,
  `role` enum('member','owner') NOT NULL,
  PRIMARY KEY (`circle_id`,`user_id`),
  KEY `ix_circle_member_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `circle_posts`
--

DROP TABLE IF EXISTS `circle_posts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `circle_posts` (
  `id` char(36) NOT NULL,
  `body` text NOT NULL,
  `circle_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_circle_post_circle_time` (`circle_id`,`created_at`),
  KEY `ix_circle_post_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `circles`
--

DROP TABLE IF EXISTS `circles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `circles` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `created_by` char(36) NOT NULL,
  `goal` text,
  `name` varchar(120) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_circles_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `daily_logs`
--

DROP TABLE IF EXISTS `daily_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_logs` (
  `log_date` date NOT NULL,
  `user_id` char(36) NOT NULL,
  `bedtime` varchar(5) DEFAULT NULL,
  `energy` varchar(16) DEFAULT NULL,
  `kcal` int DEFAULT NULL,
  `mood` varchar(16) DEFAULT NULL,
  `mood_note` text,
  `score` int DEFAULT NULL,
  `sleep_note` text,
  `sleep_quality` varchar(16) DEFAULT NULL,
  `stress` varchar(16) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  `wake_time` varchar(5) DEFAULT NULL,
  `water_goal_ml` int DEFAULT NULL,
  `water_ml` int DEFAULT NULL,
  PRIMARY KEY (`log_date`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `daily_scores`
--

DROP TABLE IF EXISTS `daily_scores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_scores` (
  `score_date` date NOT NULL,
  `user_id` char(36) NOT NULL,
  `habits_done` int NOT NULL,
  `habits_total` int NOT NULL,
  `score` int NOT NULL,
  `tasks_done` int NOT NULL,
  `tasks_total` int NOT NULL,
  `workout_done` bit(1) NOT NULL,
  PRIMARY KEY (`score_date`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_verification_tokens`
--

DROP TABLE IF EXISTS `email_verification_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_verification_tokens` (
  `token_hash` varchar(255) NOT NULL,
  `consumed_at` datetime(6) DEFAULT NULL,
  `expires_at` datetime(6) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `families`
--

DROP TABLE IF EXISTS `families`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `families` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `owner_user_id` char(36) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_owner` (`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_dish_preferences`
--

DROP TABLE IF EXISTS `family_dish_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_dish_preferences` (
  `id` char(36) NOT NULL,
  `dish_name` varchar(160) NOT NULL,
  `family_id` char(36) NOT NULL,
  `last_seen` datetime(6) NOT NULL,
  `score` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_family_dish` (`family_id`,`dish_name`),
  KEY `ix_family_dish_family` (`family_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_favourite_menus`
--

DROP TABLE IF EXISTS `family_favourite_menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_favourite_menus` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `created_by_user_id` char(36) NOT NULL,
  `family_id` char(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `occasion` varchar(16) DEFAULT NULL,
  `plan_json` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_fav_family` (`family_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_meal_plans`
--

DROP TABLE IF EXISTS `family_meal_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_meal_plans` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `family_id` char(36) NOT NULL,
  `generated_by_user_id` char(36) NOT NULL,
  `grocery_items_json` text,
  `plan_json` text NOT NULL,
  `source` varchar(24) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_meal_plan_family` (`family_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_members`
--

DROP TABLE IF EXISTS `family_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_members` (
  `id` char(36) NOT NULL,
  `allergies` text,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `diet_preference` varchar(32) DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `family_id` char(36) NOT NULL,
  `favourite_dishes` text,
  `favourite_ingredients` text,
  `gender` varchar(20) DEFAULT NULL,
  `ingredients_to_avoid` text,
  `linked_user_id` char(36) DEFAULT NULL,
  `medical_conditions` text,
  `name` varchar(120) NOT NULL,
  `relationship` enum('brother','child','father','grandfather','grandmother','mother','other','self','sister','spouse') NOT NULL,
  `status` enum('invited','mapped','unmapped') NOT NULL,
  `invite_only` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime(6) NOT NULL,
  `height_cm` int DEFAULT NULL,
  `weight_kg` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_member_family` (`family_id`),
  KEY `ix_family_member_linked` (`linked_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_multi_day_plans`
--

DROP TABLE IF EXISTS `family_multi_day_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_multi_day_plans` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `days` int NOT NULL,
  `family_id` char(36) NOT NULL,
  `generated_by_user_id` char(36) NOT NULL,
  `occasion` varchar(16) DEFAULT NULL,
  `plan_json` text NOT NULL,
  `source` varchar(24) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_multiday_family` (`family_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_pantry_items`
--

DROP TABLE IF EXISTS `family_pantry_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_pantry_items` (
  `id` char(36) NOT NULL,
  `category` varchar(32) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `family_id` char(36) NOT NULL,
  `is_leftover` bit(1) NOT NULL,
  `name` varchar(120) NOT NULL,
  `quantity` varchar(60) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_pantry_family` (`family_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_shopping_items`
--

DROP TABLE IF EXISTS `family_shopping_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_shopping_items` (
  `id` char(36) NOT NULL,
  `checked` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `created_by_user_id` char(36) NOT NULL,
  `estimated_cost` int DEFAULT NULL,
  `family_id` char(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `quantity` varchar(60) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_family_shopping_family` (`family_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `focus_sessions`
--

DROP TABLE IF EXISTS `focus_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `focus_sessions` (
  `id` char(36) NOT NULL,
  `completed_at` datetime(6) NOT NULL,
  `duration_sec` int NOT NULL,
  `mode` varchar(16) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_focus_user_time` (`user_id`,`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `food_entries`
--

DROP TABLE IF EXISTS `food_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `food_entries` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `estimate_source` varchar(20) NOT NULL,
  `food_name` varchar(255) NOT NULL,
  `kcal_estimated` int NOT NULL,
  `kcal_per_100g` int NOT NULL,
  `log_date` date NOT NULL,
  `logged_at` datetime(6) NOT NULL,
  `meal_type` enum('home','hotel') NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `quantity_grams` int NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_food_entry_user_date` (`user_id`,`log_date`),
  KEY `ix_food_entry_user_time` (`user_id`,`logged_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `food_photo_logs`
--

DROP TABLE IF EXISTS `food_photo_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `food_photo_logs` (
  `id` char(36) NOT NULL,
  `confidence` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `fallback_needed` bit(1) NOT NULL,
  `food_name` varchar(255) NOT NULL,
  `log_date` date NOT NULL,
  `meal_type` varchar(32) DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_food_photo_user_time` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `goal_actions`
--

DROP TABLE IF EXISTS `goal_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_actions` (
  `id` char(36) NOT NULL,
  `goal_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `user_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `note` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `action_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_goal_action_goal_time` (`goal_id`,`created_at`),
  KEY `ix_goal_action_user_time` (`user_id`,`created_at`),
  CONSTRAINT `fk_goal_action_goal` FOREIGN KEY (`goal_id`) REFERENCES `goals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_action_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `goals`
--

DROP TABLE IF EXISTS `goals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goals` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `user_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `description` varchar(1000) DEFAULT NULL,
  `horizon` tinyint NOT NULL,
  `target_date` date DEFAULT NULL,
  `completed` tinyint(1) NOT NULL DEFAULT '0',
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `progress_json` text,
  PRIMARY KEY (`id`),
  KEY `ix_goal_user_horizon` (`user_id`,`horizon`),
  KEY `ix_goal_user_completed` (`user_id`,`completed`),
  CONSTRAINT `fk_goal_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `google_calendar_links`
--

DROP TABLE IF EXISTS `google_calendar_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `google_calendar_links` (
  `user_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `google_email` varchar(254) DEFAULT NULL,
  `refresh_token` varchar(512) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `google_oauth_settings`
--

DROP TABLE IF EXISTS `google_oauth_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `google_oauth_settings` (
  `id` int NOT NULL,
  `client_id` varchar(200) NOT NULL,
  `client_secret` varchar(200) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `habit_checkins`
--

DROP TABLE IF EXISTS `habit_checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `habit_checkins` (
  `habit_id` char(36) NOT NULL,
  `log_date` date NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `done` bit(1) NOT NULL,
  `note` text,
  `user_id` char(36) NOT NULL,
  `protected_day` bit(1) NOT NULL,
  PRIMARY KEY (`habit_id`,`log_date`),
  KEY `ix_habit_checkin_user_date` (`user_id`,`log_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `habit_streaks`
--

DROP TABLE IF EXISTS `habit_streaks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `habit_streaks` (
  `habit_id` char(36) NOT NULL,
  `current_streak` int NOT NULL,
  `last_done_on` date DEFAULT NULL,
  `longest_streak` int NOT NULL,
  PRIMARY KEY (`habit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `habits`
--

DROP TABLE IF EXISTS `habits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `habits` (
  `id` char(36) NOT NULL,
  `active` bit(1) NOT NULL,
  `cadence` enum('custom','daily','weekly') NOT NULL,
  `color` varchar(16) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `domain` enum('fitness','habit','journal','study') NOT NULL,
  `icon` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `reminder_time` time(6) DEFAULT NULL,
  `target_per_week` int NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_habits_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_messages`
--

DROP TABLE IF EXISTS `mentor_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_messages` (
  `id` char(36) NOT NULL,
  `content` mediumtext NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `role` enum('assistant','system','user') NOT NULL,
  `thread_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_mentor_msg_thread_time` (`thread_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_threads`
--

DROP TABLE IF EXISTS `mentor_threads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_threads` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_mentor_thread_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentorship_requests`
--

DROP TABLE IF EXISTS `mentorship_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentorship_requests` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `direction` enum('offer','request') NOT NULL,
  `from_user_id` char(36) NOT NULL,
  `note` varchar(500) DEFAULT NULL,
  `responded_at` datetime(6) DEFAULT NULL,
  `status` enum('accepted','cancelled','pending','rejected') NOT NULL,
  `to_user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `money_state`
--

DROP TABLE IF EXISTS `money_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `money_state` (
  `user_id` char(36) NOT NULL,
  `data` json DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` char(36) NOT NULL,
  `body` text,
  `created_at` datetime(6) NOT NULL,
  `kind` enum('mentorship_accepted','mentorship_rejected','mentorship_request','system') NOT NULL,
  `read_at` datetime(6) DEFAULT NULL,
  `related_id` char(36) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_credentials`
--

DROP TABLE IF EXISTS `password_credentials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_credentials` (
  `user_id` char(36) NOT NULL,
  `algo` varchar(32) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `token_hash` varchar(255) NOT NULL,
  `consumed_at` datetime(6) DEFAULT NULL,
  `expires_at` datetime(6) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `push_subscriptions`
--

DROP TABLE IF EXISTS `push_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `push_subscriptions` (
  `id` char(36) NOT NULL,
  `auth` varchar(255) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `endpoint` text NOT NULL,
  `p256dh` varchar(255) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quotes`
--

DROP TABLE IF EXISTS `quotes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quotes` (
  `id` char(36) NOT NULL,
  `author` varchar(120) DEFAULT NULL,
  `body` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reminder_dispatch_log`
--

DROP TABLE IF EXISTS `reminder_dispatch_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reminder_dispatch_log` (
  `id` char(36) NOT NULL,
  `channel` varchar(16) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `occurrence_date` date NOT NULL,
  `reminder_id` char(36) NOT NULL,
  `status` varchar(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_rem_dispatch_unique` (`reminder_id`,`occurrence_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `device_label` varchar(120) DEFAULT NULL,
  `expires_at` datetime(6) NOT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `last_used_at` datetime(6) NOT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  `refresh_token_hash` varchar(255) NOT NULL,
  `user_agent` text,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UK_cairj5kyeqdedpai90prd84m5` (`refresh_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `streak_freeze_wallets`
--

DROP TABLE IF EXISTS `streak_freeze_wallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `streak_freeze_wallets` (
  `user_id` char(36) NOT NULL,
  `tokens` int NOT NULL,
  `week_anchor` date NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_completion_history`
--

DROP TABLE IF EXISTS `task_completion_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_completion_history` (
  `id` char(36) NOT NULL,
  `changed_at` datetime(6) NOT NULL,
  `due_at` datetime(6) DEFAULT NULL,
  `priority` varchar(8) NOT NULL,
  `task_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_task_hist_user_task_time` (`user_id`,`task_id`,`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tasks`
--

DROP TABLE IF EXISTS `tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tasks` (
  `id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `done` bit(1) NOT NULL,
  `done_at` datetime(6) DEFAULT NULL,
  `due_at` datetime(6) DEFAULT NULL,
  `notes` text,
  `priority` enum('High','Low','Medium') NOT NULL,
  `title` varchar(255) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tasks_user_done` (`user_id`,`done`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `about_me` varchar(500) DEFAULT NULL,
  `age_years` int DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  `daily_food_goal_kcal` int DEFAULT NULL,
  `daily_water_goal_ml` int DEFAULT NULL,
  `diet_preference` varchar(64) DEFAULT NULL,
  `display_name` varchar(120) NOT NULL,
  `email` varchar(254) NOT NULL,
  `email_verified` bit(1) NOT NULL,
  `height_cm` int DEFAULT NULL,
  `level` int NOT NULL,
  `timezone` varchar(64) NOT NULL,
  `dob` date DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  `weight_kg` int DEFAULT NULL,
  `whatsapp_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `whatsapp_number` varchar(20) DEFAULT NULL,
  `xp_total` int NOT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `fitness_goal` varchar(100) DEFAULT NULL,
  `whatsapp_verified` tinyint(1) NOT NULL DEFAULT '0',
  `feature_prefs` json DEFAULT NULL,
  `allergic_to` varchar(255) DEFAULT NULL,
  `favourite_dish` varchar(120) DEFAULT NULL,
  `digest_frequency` varchar(16) NOT NULL DEFAULT 'off',
  `digest_hour` int NOT NULL DEFAULT '8',
  `home_layout` json DEFAULT NULL,
  `last_digest_on` date DEFAULT NULL,
  `nav_layout` json DEFAULT NULL,
  `ui_prefs` json DEFAULT NULL,
  `is_admin` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `UK_6dotkott2kjsp8vw4d0m25fb7` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `water_entries`
--

DROP TABLE IF EXISTS `water_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `water_entries` (
  `id` char(36) NOT NULL,
  `amount_ml` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `log_date` date NOT NULL,
  `logged_at` datetime(6) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_water_entry_user_date` (`user_id`,`log_date`),
  KEY `ix_water_entry_user_time` (`user_id`,`logged_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `water_goals`
--

DROP TABLE IF EXISTS `water_goals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `water_goals` (
  `user_id` char(36) NOT NULL,
  `goal_ml` int NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `weekly_reviews`
--

DROP TABLE IF EXISTS `weekly_reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `weekly_reviews` (
  `id` char(36) NOT NULL,
  `focus` varchar(255) DEFAULT NULL,
  `saved_at` datetime(6) NOT NULL,
  `user_id` char(36) NOT NULL,
  `week_start` date NOT NULL,
  `wins` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UKkehyqqd8f9e6ogi8aqmd1s3xa` (`user_id`,`week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `whatsapp_otp_tokens`
--

DROP TABLE IF EXISTS `whatsapp_otp_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_otp_tokens` (
  `token_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `consumed_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_wa_otp_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-26 22:51:43
