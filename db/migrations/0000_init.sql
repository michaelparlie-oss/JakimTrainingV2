CREATE TABLE `alert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`created_at` integer NOT NULL,
	`date` text NOT NULL,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`related_id` text,
	`proposal_id` integer,
	`dismissed` integer DEFAULT false NOT NULL,
	`resolved` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_key` ON `alert` (`key`);--> statement-breakpoint
CREATE TABLE `checkpoint_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint_id` text NOT NULL,
	`date` text NOT NULL,
	`test_kind` text NOT NULL,
	`time_s` integer,
	`avg_hr` real,
	`strava_activity_id` integer,
	`zone_set_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_change` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`before_json` text NOT NULL,
	`proposal_id` integer,
	`undone` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_session` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`week` text NOT NULL,
	`phase` text NOT NULL,
	`category` text NOT NULL,
	`kind` text,
	`title` text NOT NULL,
	`distance_km` real,
	`est_duration_min` real,
	`zone_set` text NOT NULL,
	`deload_week` integer NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`template` text,
	`segments_json` text,
	`summary` text,
	`rpe_text` text,
	`post_run_log_json` text
);
--> statement-breakpoint
CREATE INDEX `plan_session_date` ON `plan_session` (`date`);--> statement-breakpoint
CREATE TABLE `plan_week` (
	`code` text PRIMARY KEY NOT NULL,
	`start_date` text NOT NULL,
	`phase` text NOT NULL,
	`zone_set` text NOT NULL,
	`deload` integer NOT NULL,
	`planned_run_km` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`rule_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`options_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` integer,
	`chosen_option` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_fp` ON `proposal` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `session_match` (
	`plan_session_id` text PRIMARY KEY NOT NULL,
	`strava_activity_id` integer,
	`status` text NOT NULL,
	`distance_ratio` real,
	`distance_score` real,
	`pace_score` real,
	`hr_score` real,
	`overall_score` real,
	`verdict` text,
	`details_json` text,
	`matched_at` integer NOT NULL,
	`manual_override` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_override` (
	`plan_session_id` text PRIMARY KEY NOT NULL,
	`date` text,
	`slot` text,
	`skipped` integer DEFAULT false NOT NULL,
	`distance_km` real,
	`title` text,
	`segments_json` text,
	`est_duration_min` real,
	`force_deload` integer,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`change_id` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strava_activity` (
	`id` integer PRIMARY KEY NOT NULL,
	`start_date_local` text NOT NULL,
	`local_date` text NOT NULL,
	`sport_type` text NOT NULL,
	`name` text,
	`description` text,
	`distance_m` real,
	`moving_time_s` integer,
	`elapsed_time_s` integer,
	`avg_hr` real,
	`max_hr` real,
	`avg_speed` real,
	`total_elevation_gain` real,
	`laps_json` text,
	`streams_json` text,
	`raw_json` text,
	`detail_fetched` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_local_date` ON `strava_activity` (`local_date`);--> statement-breakpoint
CREATE TABLE `strava_token` (
	`id` integer PRIMARY KEY NOT NULL,
	`athlete_id` integer,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scope` text
);
--> statement-breakpoint
CREATE TABLE `strength_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_session_id` text NOT NULL,
	`exercise_key` text NOT NULL,
	`set_no` integer NOT NULL,
	`reps` integer,
	`weight_kg` real,
	`rpe` real,
	`note` text,
	`logged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wellbeing_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`strava_activity_id` integer,
	`knee_pain` integer,
	`bunion_pain` integer,
	`rpe` integer,
	`carbs_g` integer,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `zone_set` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`basis_kind` text NOT NULL,
	`basis_seconds` real,
	`goal_time_s` integer,
	`created_at` integer NOT NULL,
	`effective_from_date` text,
	`source` text NOT NULL,
	`checkpoint_id` text,
	`zones_json` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
