-- Production-safe: add assets indexes only if missing
-- Run against your production database in phpMyAdmin / MySQL client.
-- Safe to re-run.

DELIMITER $$

DROP PROCEDURE IF EXISTS ensure_assets_indexes $$
CREATE PROCEDURE ensure_assets_indexes()
BEGIN
  DECLARE dbname VARCHAR(64);
  SET dbname = DATABASE();

  -- Primary key on id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `assets` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE asset_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'asset_code'
  ) THEN
    ALTER TABLE `assets` ADD UNIQUE KEY `asset_code` (`asset_code`);
  END IF;

  -- KEY custodianId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'custodianId'
  ) THEN
    ALTER TABLE `assets` ADD KEY `custodianId` (`custodianId`);
  END IF;

  -- KEY createdBy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'createdBy'
  ) THEN
    ALTER TABLE `assets` ADD KEY `createdBy` (`createdBy`);
  END IF;

  -- KEY updatedBy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'updatedBy'
  ) THEN
    ALTER TABLE `assets` ADD KEY `updatedBy` (`updatedBy`);
  END IF;
END $$

DELIMITER ;

CALL ensure_assets_indexes();
DROP PROCEDURE IF EXISTS ensure_assets_indexes;
