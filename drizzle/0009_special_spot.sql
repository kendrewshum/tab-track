ALTER TABLE `group_invitations` ADD `cancelled_by_user_id` text REFERENCES users(id) ON DELETE set null;
