CREATE TABLE `expense_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`before_snapshot` text NOT NULL,
	`after_snapshot` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `settlements` ADD `reversal_of_settlement_id` text REFERENCES settlements(id);