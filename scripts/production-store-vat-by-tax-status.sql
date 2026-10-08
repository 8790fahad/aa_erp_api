-- Production update: VAT on stock lines from the product VAT status.
--
-- Taxable              cost includes 7.5% VAT. VAT = cost x 7.5 / 107.5
-- Zero Rated           no VAT
-- Non-Taxable          no VAT
-- Exempted             no VAT
--
-- Covers purchases, opening stock (type opening and opening_balance),
-- and sales issues. cost_price is left as recorded (cost + VAT).
-- vat_amount is the VAT for the whole line.
-- Does not change the general ledger.
--
-- Run the preview first. Run the update only after the preview looks right.

-- 1. Column (skip if store_entries.vat_amount already exists)
SET @has_vat := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'store_entries'
    AND COLUMN_NAME = 'vat_amount'
);
SET @add_vat := IF(
  @has_vat = 0,
  'ALTER TABLE store_entries ADD COLUMN vat_amount DECIMAL(20,2) NOT NULL DEFAULT 0',
  'SELECT ''store_entries.vat_amount already exists'' AS note'
);
PREPARE add_vat_stmt FROM @add_vat;
EXECUTE add_vat_stmt;
DEALLOCATE PREPARE add_vat_stmt;

-- 2. Preview
SELECT
  p.taxable,
  COUNT(*) AS lines,
  ROUND(SUM(
    CASE
      WHEN p.taxable = 'Taxable' AND COALESCE(se.vat_amount, 0) = 0 AND se.cost_price > 0
      THEN (CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE se.qty_out END)
           * se.cost_price * 7.5 / 107.5
      ELSE 0
    END
  ), 2) AS vat_to_write
FROM store_entries se
INNER JOIN products p
  ON p.sku = se.product_id
 AND p.facility_id = se.facilityId
WHERE se.qty_in > 0 OR se.qty_out > 0
GROUP BY p.taxable
ORDER BY p.taxable;

-- 3. Write VAT on Taxable lines that do not have it yet
UPDATE store_entries se
INNER JOIN products p
  ON p.sku = se.product_id
 AND p.facility_id = se.facilityId
SET se.vat_amount = ROUND(
  (CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE se.qty_out END)
  * se.cost_price * 7.5 / 107.5
, 2)
WHERE p.taxable = 'Taxable'
  AND se.cost_price > 0
  AND COALESCE(se.vat_amount, 0) = 0
  AND (se.qty_in > 0 OR se.qty_out > 0);
