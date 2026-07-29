CREATE TABLE `auth_attempts` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`failure_count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_expires_at_idx` ON `auth_attempts` (`expires_at`);