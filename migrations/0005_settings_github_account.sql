-- The GitHub account the selected repository and the mappings belong to.
-- Connecting a different account resets the repository and its mappings.
ALTER TABLE `app_settings` ADD `github_account` text;
