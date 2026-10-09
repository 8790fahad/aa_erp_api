-- Same change as migrations/20261008224000-bakers-pride-cost-47000.js.
-- Bakers Pride Flour is SKU P005 (Zero Rated). Unit cost 45,000 becomes 47,000.
-- Selling price is left as it is.
-- Covers the product, stock receipts, sales issues, cost of sales,
-- inventory reduction, and the opening-balance pair.
-- Safe to run again: a line already at 47,000 is skipped.

-- Backup. Copies every row this script can change into bak_bakers_pride_47000_*
-- tables. Run this part first and keep the tables until you have checked the
-- books. INSERT IGNORE keeps the first copy if the script is run again.
-- To restore a table: UPDATE it from its backup on the primary key.

CREATE TABLE IF NOT EXISTS bak_bakers_pride_47000_products LIKE products;
INSERT IGNORE INTO bak_bakers_pride_47000_products
SELECT p.* FROM products p
WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%';

CREATE TABLE IF NOT EXISTS bak_bakers_pride_47000_store_entries LIKE store_entries;
INSERT IGNORE INTO bak_bakers_pride_47000_store_entries
SELECT se.* FROM store_entries se
INNER JOIN products p
  ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
 AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
  AND se.cost_price IN (45000, 47000);

CREATE TABLE IF NOT EXISTS bak_bakers_pride_47000_general_ledger LIKE general_ledger;
INSERT IGNORE INTO bak_bakers_pride_47000_general_ledger
SELECT gl.* FROM general_ledger gl
WHERE (
    (gl.transaction_description LIKE 'COGS [P005] %'
      OR gl.transaction_description LIKE 'Inventory reduction [P005] %')
    AND EXISTS (
      SELECT 1 FROM store_entries se
      INNER JOIN products p
        ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
       AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
      WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
        AND se.qty_out > 0
        AND se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
        AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
    )
  )
  OR (
    gl.transaction_ref = 'P005'
    AND gl.type IN ('inventory', 'opening_balance')
    AND gl.transaction_description LIKE 'Opening Balance%Bakers Pride%'
  );

CREATE TABLE IF NOT EXISTS bak_bakers_pride_47000_inventory_valuation LIKE inventory_valuation;
INSERT IGNORE INTO bak_bakers_pride_47000_inventory_valuation
SELECT iv.* FROM inventory_valuation iv
INNER JOIN products p
  ON p.sku COLLATE utf8mb4_general_ci = iv.product_id COLLATE utf8mb4_general_ci
 AND p.facility_id COLLATE utf8mb4_general_ci = iv.facility_id COLLATE utf8mb4_general_ci
WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%';

-- Row counts in each backup, to compare with the preview below.
SELECT 'products' AS tbl, COUNT(*) AS rows_backed_up FROM bak_bakers_pride_47000_products
UNION ALL SELECT 'store_entries', COUNT(*) FROM bak_bakers_pride_47000_store_entries
UNION ALL SELECT 'general_ledger', COUNT(*) FROM bak_bakers_pride_47000_general_ledger
UNION ALL SELECT 'inventory_valuation', COUNT(*) FROM bak_bakers_pride_47000_inventory_valuation;

START TRANSACTION;

-- Preview
SELECT
  p.sku,
  p.name,
  p.cost_price,
  COUNT(se.id) AS stock_lines,
  ROUND(SUM(CASE WHEN se.cost_price = 45000 THEN 1 ELSE 0 END), 0) AS lines_at_45000
FROM products p
LEFT JOIN store_entries se
  ON se.product_id COLLATE utf8mb4_general_ci = p.sku COLLATE utf8mb4_general_ci
 AND se.facilityId COLLATE utf8mb4_general_ci = p.facility_id COLLATE utf8mb4_general_ci
WHERE p.sku = 'P005'
  AND p.name LIKE 'Bakers Pride%'
GROUP BY p.sku, p.name, p.cost_price;

-- 1. Product cost
UPDATE products
SET cost_price = 47000
WHERE sku = 'P005'
  AND name LIKE 'Bakers Pride%'
  AND cost_price = 45000;

-- 2. Sales cost of sales, while the store line is still at 45,000
UPDATE general_ledger gl
INNER JOIN (
  SELECT
    reference_number,
    facilityId,
    SUM(qty_out) AS qty
  FROM store_entries
  WHERE product_id = 'P005'
    AND qty_out > 0
    AND cost_price = 45000
  GROUP BY reference_number, facilityId
) se
  ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
 AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
SET gl.dr = ROUND(se.qty * 47000, 2)
WHERE gl.transaction_description LIKE 'COGS [P005] %'
  AND ABS(gl.dr - (se.qty * 45000)) < 0.05;

UPDATE general_ledger gl
INNER JOIN (
  SELECT
    reference_number,
    facilityId,
    SUM(qty_out) AS qty
  FROM store_entries
  WHERE product_id = 'P005'
    AND qty_out > 0
    AND cost_price = 45000
  GROUP BY reference_number, facilityId
) se
  ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
 AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
SET gl.cr = ROUND(se.qty * 47000, 2)
WHERE gl.transaction_description LIKE 'Inventory reduction [P005] %'
  AND ABS(gl.cr - (se.qty * 45000)) < 0.05;

-- 3. Opening stock in the ledger, and the matching equity credit
UPDATE general_ledger
SET
  dr = ROUND(dr / 45000 * 47000, 2),
  transaction_description = REPLACE(transaction_description, '@ 45000', '@ 47000')
WHERE transaction_ref = 'P005'
  AND type = 'inventory'
  AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 45000'
  AND dr > 0;

UPDATE general_ledger
SET
  cr = ROUND(cr / 45000 * 47000, 2),
  transaction_description = REPLACE(transaction_description, '@ 45000', '@ 47000')
WHERE transaction_ref = 'P005'
  AND type = 'opening_balance'
  AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 45000'
  AND cr > 0;

-- 4. Stock lines, including the ones sold
UPDATE store_entries
SET cost_price = 47000
WHERE product_id = 'P005'
  AND cost_price = 45000;

-- 5. Stored valuation row, if this product has one at the old cost
UPDATE inventory_valuation
SET
  avg_unit_cost = 47000,
  total_value = ROUND(quantity_on_hand * 47000, 2)
WHERE product_id = 'P005'
  AND quantity_on_hand > 0
  AND (
    avg_unit_cost = 45000
    OR ABS(total_value - (quantity_on_hand * 45000)) < 1
  );

COMMIT;
