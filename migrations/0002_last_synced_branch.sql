ALTER TABLE `theme_states` ADD `last_synced_branch` text;--> statement-breakpoint
UPDATE `theme_states` SET `last_synced_branch` = (SELECT `branch` FROM `sync_history` WHERE `sync_history`.`id` = `theme_states`.`last_sync_id`) WHERE `last_sync_id` IS NOT NULL;
