ALTER TABLE `expenses` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `deleted_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;
