ALTER TABLE `shops` ADD `shopify_client_id` text;--> statement-breakpoint
CREATE INDEX `shops_client_id_idx` ON `shops` (`shopify_client_id`);