-- Fix ER_NO_DEFAULT_FOR_FIELD: Field 'id' doesn't have a default value
-- on supplier_contacts / supplier_addresses after a dump import without AUTO_INCREMENT.
-- Run in phpMyAdmin on flowbooks_db.

ALTER TABLE `supplier_contacts`
  ADD COLUMN `_fix_id` INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST;
UPDATE `supplier_contacts` SET `id` = `_fix_id`;
ALTER TABLE `supplier_contacts` DROP INDEX `_fix_id`, DROP COLUMN `_fix_id`;
ALTER TABLE `supplier_contacts` ADD PRIMARY KEY (`id`);
ALTER TABLE `supplier_contacts` MODIFY `id` INT NOT NULL AUTO_INCREMENT;

ALTER TABLE `supplier_addresses`
  ADD COLUMN `_fix_id` INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST;
UPDATE `supplier_addresses` SET `id` = `_fix_id`;
ALTER TABLE `supplier_addresses` DROP INDEX `_fix_id`, DROP COLUMN `_fix_id`;
ALTER TABLE `supplier_addresses` ADD PRIMARY KEY (`id`);
ALTER TABLE `supplier_addresses` MODIFY `id` INT NOT NULL AUTO_INCREMENT;
