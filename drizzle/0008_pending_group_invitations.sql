CREATE TABLE `group_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`member_id` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`claimed_by_user_id` text,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "group_invitations_role_check" CHECK("group_invitations"."role" = 'member')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_invitations_group_email_unique` ON `group_invitations` (`group_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_invitations_token_hash_unique` ON `group_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `group_invitations_expires_at_idx` ON `group_invitations` (`expires_at`);