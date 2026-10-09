-- Same change as migrations/20261008224000-bakers-pride-cost-47000.js.
-- Bakers Pride Flour is SKU P005 (Zero Rated). Unit cost 45,000 becomes 47,000.
-- Selling price is left as it is.
-- Covers the product, stock receipts, sales issues, cost of sales,
-- inventory reduction, and the opening-balance pair.
-- Safe to run again: a line already at 47,000 is skipped.

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
