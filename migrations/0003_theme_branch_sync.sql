-- Numbered 0003 because 0001/0002 were used by a reverted version; IF NOT EXISTS keeps it safe either way.
CREATE TABLE IF NOT EXISTS `theme_branch_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`branch` text NOT NULL,
	`commit_sha` text NOT NULL,
	`commit_message` text,
	`sync_id` text,
	`synced_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `theme_branch_sync_unique` ON `theme_branch_sync` (`shop_id`,`theme_id`,`branch`);