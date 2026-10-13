-- Same change as migrations/20261008223500-reverse-vat-on-non-taxable.js.
-- Products that are not Taxable (Non-Taxable, Exempted, Zero Rated, blank)
-- carry no VAT:
--   1. VAT moved out of their cost of sales is added back, and the
--      "Input VAT removed from COGS [sku]" row is deleted.
--   2. store_entries.vat_amount is set to 0 on their stock lines.
-- Taxable products are not touched.
--
-- Run the preview first. Run the backup and the update only if it looks right.
-- Run this before production-bakers-pride-cost-47000.sql.

-- Preview 1: cost of sales lines that will go back to full cost
SELECT
  p.sku,
  p.name,
  p.taxable,
  COUNT(*) AS cogs_lines,
  ROUND(SUM(gl.dr), 2) AS cost_of_sales_now,
  ROUND(SUM(done.dr), 2) AS vat_to_add_back
FROM general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
INNER JOIN general_ledger done
  ON done.facility_id = gl.facility_id
 AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
 AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
WHERE gl.transaction_description LIKE 'COGS [%'
  AND (p.taxable IS NULL OR p.taxable <> 'Taxable')
GROUP BY p.sku, p.name, p.taxable
ORDER BY vat_to_add_back DESC;

-- Preview 2: stock lines with VAT on products that are not Taxable
SELECT
  p.taxable,
  COUNT(*) AS lines,
  ROUND(SUM(se.vat_amount), 2) AS vat_to_clear
FROM store_entries se
INNER JOIN products p
  ON CONVERT(p.sku USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.product_id USING utf8mb4) COLLATE utf8mb4_general_ci
 AND CONVERT(p.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE (p.taxable IS NULL OR p.taxable <> 'Taxable')
  AND COALESCE(se.vat_amount, 0) <> 0
GROUP BY p.taxable;

-- Backup. Keep these tables until the books are checked.
-- INSERT IGNORE keeps the first copy if this is run again.
CREATE TABLE IF NOT EXISTS bak_vat_reversal_general_ledger LIKE general_ledger;
INSERT IGNORE INTO bak_vat_reversal_general_ledger
SELECT gl.*
FROM general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
INNER JOIN general_ledger done
  ON done.facility_id = gl.facility_id
 AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
 AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
WHERE gl.transaction_description LIKE 'COGS [%'
  AND (p.taxable IS NULL OR p.taxable <> 'Taxable')
UNION
SELECT done.*
FROM general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
INNER JOIN general_ledger done
  ON done.facility_id = gl.facility_id
 AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
 AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
WHERE gl.transaction_description LIKE 'COGS [%'
  AND (p.taxable IS NULL OR p.taxable <> 'Taxable');

CREATE TABLE IF NOT EXISTS bak_vat_reversal_store_entries LIKE store_entries;
INSERT IGNORE INTO bak_vat_reversal_store_entries
SELECT se.*
FROM store_entries se
INNER JOIN products p
  ON CONVERT(p.sku USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.product_id USING utf8mb4) COLLATE utf8mb4_general_ci
 AND CONVERT(p.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
WHERE (p.taxable IS NULL OR p.taxable <> 'Taxable')
  AND COALESCE(se.vat_amount, 0) <> 0;

START TRANSACTION;

-- 1. Add the VAT back to cost of sales
UPDATE general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
INNER JOIN general_ledger done
  ON done.facility_id = gl.facility_id
 AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
 AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
SET gl.dr = ROUND(gl.dr + done.dr, 2)
WHERE gl.transaction_description LIKE 'COGS [%'
  AND (p.taxable IS NULL OR p.taxable <> 'Taxable');

-- 2. Remove the Input VAT rows
DELETE done
FROM general_ledger done
INNER JOIN general_ledger gl
  ON gl.facility_id = done.facility_id
 AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
 AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
WHERE gl.transaction_description LIKE 'COGS [%'
  AND (p.taxable IS NULL OR p.taxable <> 'Taxable');

-- 3. No VAT on stock lines of products that are not Taxable
UPDATE store_entries se
INNER JOIN products p
  ON CONVERT(p.sku USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.product_id USING utf8mb4) COLLATE utf8mb4_general_ci
 AND CONVERT(p.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(se.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
SET se.vat_amount = 0
WHERE (p.taxable IS NULL OR p.taxable <> 'Taxable')
  AND COALESCE(se.vat_amount, 0) <> 0;

COMMIT;
