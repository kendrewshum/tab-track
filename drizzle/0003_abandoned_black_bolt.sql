CREATE TABLE `idempotent_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action_kind` text NOT NULL,
	`submission_token` text NOT NULL,
	`redirect_path` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotent_submissions_user_action_token_unique` ON `idempotent_submissions` (`user_id`,`action_kind`,`submission_token`);
