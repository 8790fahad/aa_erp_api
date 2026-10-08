-- Move the 7.5% VAT out of cost of sales for Taxable products only.
-- Zero Rated, Non-Taxable, and Exempted lines are not changed.
--
-- A cost-of-sales debit of 1,075.00 becomes:
--   Cost of sales   1,000.00
--   Input VAT          75.00
-- The inventory credit stays as it was, so the entry still balances.
-- Profit rises by the VAT taken out of cost of sales.
--
-- Safe to run again: a line is skipped once its Input VAT row exists.
-- Run the preview first. Then run the update.

-- Preview: VAT that will leave cost of sales
SELECT
  p.sku,
  p.taxable,
  COUNT(*) AS cogs_lines,
  ROUND(SUM(gl.dr), 2) AS cost_of_sales_now,
  ROUND(SUM(gl.dr / 1.075), 2) AS cost_of_sales_after_tax,
  ROUND(SUM(gl.dr - (gl.dr / 1.075)), 2) AS vat_moved_to_input_vat
FROM general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
WHERE gl.dr > 0
  AND p.taxable = 'Taxable'
  AND NOT EXISTS (
    SELECT 1
    FROM general_ledger done
    WHERE done.facility_id = gl.facility_id
      AND done.reference_number = gl.reference_number
      AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
  )
GROUP BY p.sku, p.taxable
ORDER BY p.sku;

START TRANSACTION;

-- 1. Debit Input VAT for the VAT taken out of each taxable cost-of-sales line
INSERT INTO general_ledger (
  transaction_date,
  account_code,
  account_subhead,
  dr,
  cr,
  account_description,
  transaction_description,
  reference_number,
  purpose_of_payment,
  payee,
  bank_account_id,
  cheque_no,
  mode_of_payment,
  created_by,
  facility_id,
  status,
  reconciled,
  type,
  transaction_ref,
  branch_id,
  user_id
)
SELECT
  gl.transaction_date,
  vat.code,
  vat.parent_code,
  ROUND(gl.dr - (gl.dr / 1.075), 2),
  0,
  vat.description,
  CONCAT('Input VAT removed from ', gl.transaction_description),
  gl.reference_number,
  gl.purpose_of_payment,
  gl.payee,
  gl.bank_account_id,
  gl.cheque_no,
  gl.mode_of_payment,
  gl.created_by,
  gl.facility_id,
  'posted',
  'unmatched',
  'tax',
  CONCAT('COGS-VAT-', gl.transaction_id),
  gl.branch_id,
  gl.user_id
FROM general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
INNER JOIN (
  SELECT
    t.facilityId,
    ac.code,
    ac.parent_code,
    ac.description
  FROM taxes t
  INNER JOIN account_category ac
    ON ac.facility_id = t.facilityId
   AND ac.code = t.account_sub_head
  WHERE t.tax_category = 'Purchase'
    AND t.inclusive_type = 'inclusive'
    AND t.description LIKE 'Input VAT%'
) vat ON vat.facilityId = gl.facility_id
WHERE gl.dr > 0
  AND p.taxable = 'Taxable'
  AND NOT EXISTS (
    SELECT 1
    FROM general_ledger done
    WHERE done.facility_id = gl.facility_id
      AND done.reference_number = gl.reference_number
      AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
  );

-- 2. Reduce those cost-of-sales debits to the cost after tax
UPDATE general_ledger gl
INNER JOIN products p
  ON p.facility_id = gl.facility_id
 AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
SET gl.dr = ROUND(gl.dr / 1.075, 2)
WHERE gl.dr > 0
  AND p.taxable = 'Taxable'
  AND EXISTS (
    SELECT 1
    FROM general_ledger done
    WHERE done.facility_id = gl.facility_id
      AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
  );

COMMIT;
