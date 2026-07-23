-- Inventory valuation seed: opening stock for United Gases Ltd
-- Facility: 2f93950a-f056-4a70-840a-74dc75c8dd41
-- As-of date for report: 2026-06-03
--
-- Populates store_entries so POST /api/reports/inventory-valuation shows qty on:
--   Raw Material | Finished Good | By-Product | Resalable | Semi Finished
--
-- Safe to re-run: only inserts where net stock (qty_in - qty_out) <= 0 as of seed date.
-- Skips Service items (not in valuation report).

SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;
START TRANSACTION;

-- COLLATE on user vars avoids #1267 (general_ci columns vs unicode_ci session)
SET @facility_id := '2f93950a-f056-4a70-840a-74dc75c8dd41' COLLATE utf8mb4_general_ci;
SET @as_of_date := '2026-06-03' COLLATE utf8mb4_general_ci;
SET @seed_ts := '2026-01-15 08:00:00';
SET @branch_id := 20;

-- ── 1. Give zero-cost products a unit cost so total_value is meaningful ──
UPDATE `products`
SET
  `cost_price` = CASE `item_type`
    WHEN 'Raw Material' THEN 500.00 + (`id` % 4500)
    WHEN 'Semi Finished' THEN 1200.00 + (`id` % 3800)
    ELSE 800.00 + (`id` % 5200)
  END,
  `reorder_level` = CASE
    WHEN `reorder_level` > 0 THEN `reorder_level`
    WHEN `item_type` = 'Raw Material' THEN 25
    ELSE 10
  END,
  `updated_at` = NOW()
WHERE `facility_id` COLLATE utf8mb4_general_ci = @facility_id
  AND `status` = 'Active'
  AND `item_type` IN ('Raw Material', 'Finished Good', 'By-Product', 'Resalable', 'Semi Finished')
  AND (`cost_price` IS NULL OR `cost_price` = 0);

-- ── 2. Opening stock receipt per SKU with no on-hand qty as of @as_of_date ──
INSERT INTO `store_entries` (
  `receive_date`,
  `reference_number`,
  `qty_in`,
  `qty_out`,
  `expiry_date`,
  `cost_price`,
  `selling_price`,
  `branch_name`,
  `inserted_by`,
  `facilityId`,
  `truckNo`,
  `waybillNo`,
  `supplier_code`,
  `type`,
  `source`,
  `destination`,
  `status`,
  `product_id`,
  `batch_id`,
  `multiplier_id`,
  `createdAt`,
  `markup_mode`,
  `mark_up`,
  `multple`,
  `location`,
  `departmentId`,
  `branchId`
)
SELECT
  DATE_FORMAT(@seed_ts, '%Y-%m-%d') AS receive_date,
  CONCAT('IV-SEED-', p.sku) AS reference_number,
  CASE p.item_type
    WHEN 'Raw Material' THEN 40.0000 + (`p`.`id` % 460)
    WHEN 'Semi Finished' THEN 15.0000 + (`p`.`id` % 85)
    ELSE 8.0000 + (`p`.`id` % 120)
  END AS qty_in,
  0.0000 AS qty_out,
  CASE
    WHEN p.item_type IN ('Finished Good', 'By-Product') THEN DATE_ADD(@seed_ts, INTERVAL (180 + (`p`.`id` % 540)) DAY)
    ELSE NULL
  END AS expiry_date,
  p.cost_price AS cost_price,
  NULLIF(p.selling_price, 0) AS selling_price,
  CASE p.item_type
    WHEN 'Raw Material' THEN 'Raw Material'
    WHEN 'Semi Finished' THEN 'Work in Progress'
    ELSE 'for sales'
  END AS branch_name,
  'seed-user' AS inserted_by,
  p.facility_id AS facilityId,
  '' AS truckNo,
  '' AS waybillNo,
  COALESCE(p.supplier_id, '') AS supplier_code,
  CASE
    WHEN p.item_type = 'Raw Material' THEN 'Raw Material'
    ELSE p.item_type
  END AS `type`,
  'Initial Stock' AS `source`,
  CASE
    WHEN p.item_type = 'Raw Material' THEN 'Raw Material'
    WHEN p.item_type = 'Semi Finished' THEN 'Work in Progress'
    ELSE 'Main Warehouse'
  END AS destination,
  'approved' AS status,
  p.sku AS product_id,
  NULL AS batch_id,
  NULL AS multiplier_id,
  @seed_ts AS createdAt,
  'percentage' AS markup_mode,
  0.00 AS mark_up,
  '1' AS multple,
  'Warehouse' AS location,
  NULL AS departmentId,
  @branch_id AS branchId
FROM `products` p
WHERE p.facility_id COLLATE utf8mb4_general_ci = @facility_id
  AND p.status = 'Active'
  AND p.item_type IN ('Raw Material', 'Finished Good', 'By-Product', 'Resalable', 'Semi Finished')
  AND (
    SELECT COALESCE(SUM(se.qty_in), 0) - COALESCE(SUM(se.qty_out), 0)
    FROM `store_entries` se
    WHERE se.product_id COLLATE utf8mb4_general_ci = p.sku
      AND se.facilityId COLLATE utf8mb4_general_ci = p.facility_id
      AND DATE(se.createdAt) <= @as_of_date
  ) <= 0;

COMMIT;

-- ── Verify (optional) ──
-- Raw materials:
-- SELECT p.sku, p.name,
--   COALESCE(SUM(se.qty_in),0)-COALESCE(SUM(se.qty_out),0) AS stock_qty
-- FROM products p
-- LEFT JOIN store_entries se ON se.product_id=p.sku AND se.facilityId=p.facility_id
--   AND DATE(se.createdAt)<='2026-06-03'
-- WHERE p.facility_id='2f93950a-f056-4a70-840a-74dc75c8dd41' AND p.item_type='Raw Material'
-- GROUP BY p.id, p.sku, p.name;
