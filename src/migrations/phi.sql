ALTER TABLE `general_ledger` ADD `reconciled` ENUM('matched','unmatched') NOT NULL DEFAULT 'unmatched' AFTER `status`; 


