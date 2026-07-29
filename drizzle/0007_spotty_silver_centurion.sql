ALTER TABLE `members` ADD `user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_group_user_unique` ON `members` (`group_id`,`user_id`);
