-- Fix MySQL #3780 for discount_table foreign keys
-- Compatible with older MySQL (no DROP FOREIGN KEY IF EXISTS).

SET FOREIGN_KEY_CHECKS = 0;
SET SESSION sql_mode = '';

-- Drop FKs only if they already exist (safe on older MySQL)
SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @db
        AND TABLE_NAME = 'discount_table'
        AND CONSTRAINT_NAME = 'fk_discount_account_head'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ),
    'ALTER TABLE `discount_table` DROP FOREIGN KEY `fk_discount_account_head`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @db
        AND TABLE_NAME = 'discount_table'
        AND CONSTRAINT_NAME = 'fk_discount_facility'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ),
    'ALTER TABLE `discount_table` DROP FOREIGN KEY `fk_discount_facility`',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Align types/charset with referenced columns
ALTER TABLE `discount_table`
  MODIFY `discount_account_head` VARCHAR(20)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
    COMMENT 'Chart of account code (account_category.code)',
  MODIFY `facilityId` VARCHAR(50)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE `account_category`
  MODIFY `code` VARCHAR(20)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
    COMMENT 'Unique code like etc. (unique per facility_id)',
  MODIFY `facility_id` VARCHAR(50)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

-- Add constraints
ALTER TABLE `discount_table`
  ADD CONSTRAINT `fk_discount_account_head`
    FOREIGN KEY (`discount_account_head`, `facilityId`)
    REFERENCES `account_category` (`code`, `facility_id`)
    ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_discount_facility`
    FOREIGN KEY (`facilityId`)
    REFERENCES `business` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
