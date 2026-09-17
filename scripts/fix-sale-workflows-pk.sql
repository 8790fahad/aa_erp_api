-- Fix #1062 Duplicate entry '1' for key 'PRIMARY' on sale_workflows.
-- Run this in phpMyAdmin on flowbooks_db BEFORE the Indexes ALTER, or instead of it.

-- 1) See duplicate ids
SELECT id, COUNT(*) AS copies
FROM sale_workflows
GROUP BY id
HAVING copies > 1
ORDER BY copies DESC, id
LIMIT 50;

-- 2) See duplicate invoices
SELECT facility_id, sale_code, COUNT(*) AS copies
FROM sale_workflows
GROUP BY facility_id, sale_code
HAVING copies > 1
LIMIT 50;

-- 3) Keep one row per facility + sale_code, then make id unique
ALTER TABLE `sale_workflows`
  ADD COLUMN `_fix_id` INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST;

DELETE `sw` FROM `sale_workflows` `sw`
INNER JOIN (
  SELECT `facility_id`, `sale_code`, MIN(`_fix_id`) AS `keep_id`
  FROM `sale_workflows`
  GROUP BY `facility_id`, `sale_code`
) `k`
  ON `sw`.`facility_id` = `k`.`facility_id`
 AND `sw`.`sale_code` = `k`.`sale_code`
WHERE `sw`.`_fix_id` <> `k`.`keep_id`;

UPDATE `sale_workflows` SET `id` = `_fix_id`;

ALTER TABLE `sale_workflows`
  DROP INDEX `_fix_id`,
  DROP COLUMN `_fix_id`;

-- 4) Add keys once (do not add two unique indexes on the same columns)
ALTER TABLE `sale_workflows`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `sale_workflows_facility_sale_unique` (`facility_id`,`sale_code`),
  ADD KEY `sale_workflows_status` (`status`),
  ADD KEY `sale_workflows_payment_type` (`payment_type`),
  ADD KEY `sale_workflows_assigned_cashier_id` (`assigned_cashier_id`);

ALTER TABLE `sale_workflows`
  MODIFY `id` INT NOT NULL AUTO_INCREMENT;
