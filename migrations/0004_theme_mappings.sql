-- Branch ↔ theme mappings (one active mapping per branch and per theme; removed rows are kept for audit)
CREATE TABLE IF NOT EXISTS `theme_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`repository` text NOT NULL,
	`branch` text NOT NULL,
	`theme_id` text NOT NULL,
	`theme_name` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `theme_mappings_active_branch_unique` ON `theme_mappings` (`shop_id`,`repository`,`branch`) WHERE removed_at is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `theme_mappings_active_theme_unique` ON `theme_mappings` (`shop_id`,`theme_id`) WHERE removed_at is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `theme_mappings_shop_idx` ON `theme_mappings` (`shop_id`);
--> statement-breakpoint
-- Multi-commit syncs: the commit each file's content comes from.
ALTER TABLE `sync_operations` ADD `source_commit_sha` text;
