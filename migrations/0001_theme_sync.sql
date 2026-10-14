CREATE TABLE `theme_file_checksums` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`path` text NOT NULL,
	`checksum_md5` text,
	`commit_sha` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_file_checksums_unique` ON `theme_file_checksums` (`shop_id`,`theme_id`,`path`);--> statement-breakpoint
CREATE TABLE `theme_states` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`last_synced_sha` text,
	`last_synced_message` text,
	`last_synced_at` integer,
	`last_sync_id` text,
	`verified_on_staging_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_states_shop_theme_unique` ON `theme_states` (`shop_id`,`theme_id`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `staging_theme_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `staging_theme_name` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `live_theme_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `live_theme_name` text;--> statement-breakpoint
ALTER TABLE `shops` ADD `shop_name` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `kind` text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `line` text DEFAULT 'staging' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `base_sha` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `base_message` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `commits_included` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `checks` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `verified_on_staging_at` integer;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `restored_from_id` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `rollout_id` text;--> statement-breakpoint
ALTER TABLE `sync_history` ADD `confirmed_at` integer;--> statement-breakpoint
CREATE INDEX `sync_history_shop_theme_idx` ON `sync_history` (`shop_id`,`theme_id`);--> statement-breakpoint
-- Existing runs: mark confirmed ones so they appear in the update history, and make sure
-- no theme has two active runs before the one-active-run index is created.
UPDATE `sync_history` SET `confirmed_at` = coalesce(`started_at`, `initiated_at`) WHERE `status` NOT IN ('previewed', 'expired');--> statement-breakpoint
UPDATE `sync_history` SET `status` = 'failed', `completed_at` = (unixepoch() * 1000) WHERE `status` IN ('queued', 'running') AND `id` NOT IN (SELECT max(`id`) FROM `sync_history` WHERE `status` IN ('queued', 'running') GROUP BY `shop_id`, `theme_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_history_one_active_per_theme` ON `sync_history` (`shop_id`,`theme_id`) WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `error_kind` text;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `content_source` text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `source_commit_sha` text;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `introduced_by` text;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `backup_state` text;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `content_key` text;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `backup_key` text;