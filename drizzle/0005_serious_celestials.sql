CREATE INDEX `expense_revisions_expense_id_idx` ON `expense_revisions` (`expense_id`);--> statement-breakpoint
CREATE INDEX `expense_splits_expense_id_idx` ON `expense_splits` (`expense_id`);--> statement-breakpoint
CREATE INDEX `expenses_group_id_date_idx` ON `expenses` (`group_id`,`date`);--> statement-breakpoint
CREATE INDEX `group_access_user_id_idx` ON `group_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `members_group_id_idx` ON `members` (`group_id`);--> statement-breakpoint
CREATE INDEX `settlements_group_id_date_idx` ON `settlements` (`group_id`,`date`);--> statement-breakpoint
CREATE INDEX `settlements_reversal_of_settlement_id_idx` ON `settlements` (`reversal_of_settlement_id`);