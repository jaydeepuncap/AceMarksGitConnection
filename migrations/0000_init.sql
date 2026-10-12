CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`default_repository` text,
	`default_branch` text,
	`default_theme_id` text,
	`default_theme_name` text,
	`sync_preferences` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_shop_unique` ON `app_settings` (`shop_id`);--> statement-breakpoint
CREATE TABLE `github_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`auth_type` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text DEFAULT 'User' NOT NULL,
	`repo_owner` text,
	`repo_name` text,
	`default_branch` text,
	`token_encrypted` text NOT NULL,
	`token_expires_at` integer,
	`last_verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_connections_shop_unique` ON `github_connections` (`shop_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`user_id` text,
	`is_online` integer DEFAULT true NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_shop_idx` ON `sessions` (`shop_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_domain` text NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`access_token_encrypted` text,
	`access_token_expires_at` integer,
	`refresh_token_encrypted` text,
	`refresh_token_expires_at` integer,
	`token_version` integer DEFAULT 0 NOT NULL,
	`installed_at` integer,
	`uninstalled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_shop_domain_unique` ON `shops` (`shop_domain`);--> statement-breakpoint
CREATE INDEX `shops_status_idx` ON `shops` (`status`);--> statement-breakpoint
CREATE TABLE `sync_history` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`repository` text NOT NULL,
	`branch` text,
	`commit_sha` text NOT NULL,
	`commit_message` text,
	`theme_id` text NOT NULL,
	`theme_name` text NOT NULL,
	`theme_role` text NOT NULL,
	`strategy` text NOT NULL,
	`status` text NOT NULL,
	`files_changed` integer DEFAULT 0 NOT NULL,
	`files_succeeded` integer DEFAULT 0 NOT NULL,
	`files_failed` integer DEFAULT 0 NOT NULL,
	`files_skipped` integer DEFAULT 0 NOT NULL,
	`error_details` text,
	`options` text DEFAULT '{}' NOT NULL,
	`initiated_by` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`preview_expires_at` integer,
	`initiated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_history_shop_initiated_idx` ON `sync_history` (`shop_id`,`initiated_at`);--> statement-breakpoint
CREATE INDEX `sync_history_shop_status_idx` ON `sync_history` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `sync_history_shop_commit_idx` ON `sync_history` (`shop_id`,`commit_sha`);--> statement-breakpoint
CREATE TABLE `sync_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`path` text NOT NULL,
	`source_path` text,
	`previous_path` text,
	`action` text NOT NULL,
	`change_type` text NOT NULL,
	`blob_sha` text,
	`size` integer,
	`exists_in_theme` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sync_id`) REFERENCES `sync_history`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_operations_sync_path_unique` ON `sync_operations` (`sync_id`,`path`);--> statement-breakpoint
CREATE INDEX `sync_operations_sync_status_idx` ON `sync_operations` (`sync_id`,`status`);--> statement-breakpoint
CREATE INDEX `sync_operations_shop_idx` ON `sync_operations` (`shop_id`);