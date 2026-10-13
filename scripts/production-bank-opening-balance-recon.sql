-- Bring each bank ledger from SYSTEM to ACTUAL.
-- After this runs, FlowBooks bank balance = ACTUAL (column F).
-- Counterpart is Opening Balance Equity — not Cost of Sales.
--
-- SYSTEM  = current FlowBooks ledger (column E)
-- ACTUAL  = target balance (column F)
-- Opening balance posted = ACTUAL − SYSTEM
--   positive → Debit bank / Credit Opening Balance Equity
--   negative → Debit Opening Balance Equity / Credit bank
--
-- Do NOT post the ACTUAL amount itself. That would double-count.
-- Example: FCMB (Ashiru Ali) SYSTEM 170,141,218.60, ACTUAL 170,951,621.35
--          → debit bank 810,402.75 so the ledger becomes 170,951,621.35.
--
-- Accounts that already match ACTUAL are listed but not posted.
-- Safe to run again: a bank is skipped once its OB-BRK reference exists.
--
-- How to run:
--   1. Run through the PREVIEW. Every non-zero row must be "ok".
--   2. If unmatched, set account_code on that mapping row and re-run.
--   3. Run the START TRANSACTION block. COMMIT only if verify totals match.

SET @facility_id = '094c6e1e-dd07-48c4-a344-6e9d58cd7861';
SET @ob_date = '2026-01-01';
SET @batch = 'OB-BRK';
SET @created_by = 'sql-ob-bank-recon';

SET @equity_code = (
  SELECT NULLIF(TRIM(opening_balance_equity), '')
  FROM business
  WHERE id = @facility_id
  LIMIT 1
);

DROP TEMPORARY TABLE IF EXISTS tmp_bank_ob_map;
DROP TEMPORARY TABLE IF EXISTS tmp_bank_ob_resolved;

CREATE TEMPORARY TABLE tmp_bank_ob_map (
  seq INT NOT NULL,
  label VARCHAR(80) NOT NULL,
  system_balance DECIMAL(20,2) NOT NULL,
  actual_balance DECIMAL(20,2) NOT NULL,
  bank_re VARCHAR(120) NOT NULL,
  owner_re VARCHAR(120) NOT NULL,
  exclude_re VARCHAR(160) NOT NULL,
  account_code VARCHAR(20) NULL,
  PRIMARY KEY (seq)
);

INSERT INTO tmp_bank_ob_map
  (seq, label, system_balance, actual_balance, bank_re, owner_re, exclude_re, account_code)
VALUES
  ( 1, 'FCMB (Ashiru Ali)',            170141218.60, 170951621.35, 'FCMB|FIRST CITY MONUMENT', 'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA', NULL),
  ( 2, 'FCMB (Yammusa)',                 6117496.54,   7187296.79, 'FCMB|FIRST CITY MONUMENT', 'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 3, 'Eco Bank (Yammusa)',            10788737.00,   5564737.00, 'ECOBANK|ECO BANK',         'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 4, 'First Bank (Yammusa)',          10917264.78,   1742294.38, 'FIRST BANK',               'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU|FCMB|MONUMENT', NULL),
  ( 5, 'UBA (Yammusa)',                   130768.16,   1609527.00, 'UBA|UNITED BANK FOR AFRICA', 'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 6, 'Jaiz Bank (Yammusa)',          173424950.65, 176404877.40, 'JAIZ',                     'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 7, 'Taj Bank (Yammusa)',             1355204.77,    161715.38, 'TAJ',                      'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 8, 'Premium Trust (Yammusa)',         933000.00,    933000.00, 'PREMIUM TRUST',            'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  ( 9, 'Summit (Ashiru)',                 759391.75,    759391.75, 'SUMMIT',                   'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA', NULL),
  (10, 'Sterling (Ashiru)',              7633891.00,   4476268.84, 'STERLIN',                  'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA', NULL),
  (11, 'Sterling (Yammusa)',             2363780.59,   2363780.59, 'STERLIN',                  'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  (12, 'Polaris (Yammusa)',               795298.66,    795298.66, 'POLARI',                   'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  (13, 'Moniepoint',                     1285946.50,         4.00, 'MONIE',                    '',        '', NULL),
  (14, 'Access Bank (Yammusa)',          9558494.30,  48996386.80, 'ACCESS',                   'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  (15, 'Zenith Bank (Yammusa)',           249120.13,  17442294.38, 'ZENITH',                   'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  (16, 'Fidelity Bank (Yammusa)',         827344.75,    619234.75, 'FIDELITY',                 'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU', NULL),
  (17, 'Union Bank (Yammusa)',          18883500.00,  18644602.00, 'UNION BANK',               'YAMMUSA|YAMUSA|YANMUSA|YAMMUSUA', 'ASHIRU|VENTURE', NULL),
  (18, 'First Bank (Ashiru)',              59455.19,     59455.19, 'FIRST BANK',               'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA|FCMB|MONUMENT', NULL),
  (19, 'UBA Bank (Ashiru)',              2137001.00,   2843527.00, 'UBA|UNITED BANK FOR AFRICA', 'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA', NULL),
  (20, 'Access Bank (Ashiru)',             38279.29,     38279.29, 'ACCESS',                   'ASHIRU', 'YAMMUSA|YAMUSA|YANMUSA', NULL),
  (21, 'Union Bank (Ashiru Ventures)',    798491.09,    798387.89, 'UNION BANK',               'VENTURE', 'YAMMUSA|YAMUSA|YANMUSA', NULL);

SELECT
  ba.id,
  ba.account_name,
  ba.account_number,
  ba.head,
  ba.status,
  ac.description AS gl_description,
  ac.parent_code
FROM bank_accounts ba
LEFT JOIN account_category ac
  ON ac.facility_id = ba.facility_id
 AND ac.code = ba.head
WHERE ba.facility_id = @facility_id
ORDER BY ba.account_name;

SELECT
  @facility_id AS facility_id,
  @ob_date AS opening_balance_date,
  @equity_code AS opening_balance_equity_code,
  eq.description AS opening_balance_equity_name,
  eq.parent_code AS opening_balance_equity_parent
FROM account_category eq
WHERE eq.facility_id = @facility_id
  AND eq.code = @equity_code;

CREATE TEMPORARY TABLE tmp_bank_ob_resolved AS
SELECT
  m.seq,
  m.label,
  m.system_balance,
  m.actual_balance,
  ROUND(m.actual_balance - m.system_balance, 2) AS amount,
  CONCAT(@batch, '-', LPAD(m.seq, 2, '0')) AS reference_number,
  COALESCE(m.account_code, hit.head) AS account_code,
  hit.account_subhead,
  hit.account_description,
  hit.bank_account_id,
  hit.match_count,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM general_ledger g
      WHERE g.facility_id = @facility_id
        AND g.reference_number = CONCAT(@batch, '-', LPAD(m.seq, 2, '0'))
        AND g.type = 'opening_balance'
    ) THEN 1 ELSE 0
  END AS already_posted
FROM tmp_bank_ob_map m
LEFT JOIN (
  SELECT
    x.seq,
    x.head,
    x.account_subhead,
    x.account_description,
    x.bank_account_id,
    COUNT(*) OVER (PARTITION BY x.seq) AS match_count
  FROM (
    SELECT
      m2.seq,
      ba.head,
      IFNULL(NULLIF(TRIM(ac.parent_code), ''), '0') AS account_subhead,
      COALESCE(NULLIF(TRIM(ac.description), ''), ba.account_name) AS account_description,
      ba.id AS bank_account_id
    FROM tmp_bank_ob_map m2
    INNER JOIN bank_accounts ba
      ON ba.facility_id = @facility_id
     AND LOWER(ba.status) = 'active'
     AND NULLIF(TRIM(ba.head), '') IS NOT NULL
    LEFT JOIN account_category ac
      ON ac.facility_id = ba.facility_id
     AND ac.code = ba.head
    LEFT JOIN bank_list bl
      ON bl.facilityId = ba.facility_id
     AND bl.bank_code = ba.bank_code
    WHERE m2.account_code IS NULL
      AND UPPER(CONCAT_WS(' ',
            IFNULL(ba.account_name, ''),
            IFNULL(ac.description, ''),
            IFNULL(bl.bank_name, '')
          )) REGEXP m2.bank_re
      AND (m2.owner_re = ''
           OR UPPER(CONCAT_WS(' ',
                IFNULL(ba.account_name, ''),
                IFNULL(ac.description, ''),
                IFNULL(bl.bank_name, '')
              )) REGEXP m2.owner_re)
      AND (m2.exclude_re = ''
           OR UPPER(CONCAT_WS(' ',
                IFNULL(ba.account_name, ''),
                IFNULL(ac.description, ''),
                IFNULL(bl.bank_name, '')
              )) NOT REGEXP m2.exclude_re)
  ) x
) hit ON hit.seq = m.seq;

UPDATE tmp_bank_ob_resolved r
INNER JOIN account_category ac
  ON ac.facility_id = @facility_id
 AND ac.code = r.account_code
LEFT JOIN bank_accounts ba
  ON ba.facility_id = @facility_id
 AND ba.head = r.account_code
 AND LOWER(ba.status) = 'active'
SET
  r.account_subhead = IFNULL(NULLIF(TRIM(ac.parent_code), ''), '0'),
  r.account_description = COALESCE(NULLIF(TRIM(ac.description), ''), r.account_description, r.label),
  r.bank_account_id = COALESCE(r.bank_account_id, ba.id),
  r.match_count = 1
WHERE r.account_code IS NOT NULL
  AND (r.match_count IS NULL OR r.match_count <> 1);

-- PREVIEW: after post, ledger_after_post must equal actual_balance
SELECT
  r.seq,
  r.label,
  r.system_balance,
  r.actual_balance,
  r.amount AS opening_balance_to_post,
  ROUND(IFNULL((
    SELECT SUM(gl.dr - gl.cr)
    FROM general_ledger gl
    WHERE gl.facility_id = @facility_id
      AND gl.account_code = r.account_code
      AND IFNULL(gl.status, '') <> 'reversed'
  ), 0), 2) AS live_ledger,
  r.actual_balance AS balance_after_post,
  r.reference_number,
  r.account_code,
  r.account_description,
  r.bank_account_id,
  r.match_count,
  r.already_posted,
  CASE
    WHEN ABS(r.amount) < 0.005 THEN 'already_matches_actual'
    WHEN r.already_posted = 1 THEN 'already_posted'
    WHEN r.account_code IS NULL THEN 'unmatched'
    WHEN IFNULL(r.match_count, 0) <> 1 THEN 'ambiguous'
    ELSE 'ok'
  END AS match_status,
  CASE WHEN r.amount > 0 THEN r.amount ELSE 0 END AS bank_dr,
  CASE WHEN r.amount < 0 THEN ABS(r.amount) ELSE 0 END AS bank_cr
FROM tmp_bank_ob_resolved r
ORDER BY r.seq;

SELECT
  COUNT(*) AS mapped_rows,
  SUM(CASE WHEN ABS(amount) < 0.005 THEN 1 ELSE 0 END) AS already_matches_actual,
  SUM(CASE WHEN already_posted = 1 AND ABS(amount) >= 0.005 THEN 1 ELSE 0 END) AS already_posted,
  SUM(CASE
        WHEN already_posted = 0
         AND ABS(amount) >= 0.005
         AND account_code IS NOT NULL
         AND IFNULL(match_count, 0) = 1
        THEN 1 ELSE 0
      END) AS ready_to_post,
  SUM(CASE
        WHEN already_posted = 0
         AND ABS(amount) >= 0.005
         AND (account_code IS NULL OR IFNULL(match_count, 0) <> 1)
        THEN 1 ELSE 0
      END) AS blocked,
  ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) AS total_bank_debits,
  ROUND(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 2) AS total_bank_credits,
  ROUND(SUM(amount), 2) AS net_bank_movement
FROM tmp_bank_ob_resolved;

-- Expected control totals (15 banks with a difference):
--   total_bank_debits  = 63,676,481.34
--   total_bank_credits = 20,483,135.65
--   net_bank_movement  =  43,193,345.69  (net debit to banks / credit to equity)

START TRANSACTION;

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
  mode_of_payment,
  created_by,
  facility_id,
  status,
  reconciled,
  type,
  transaction_ref,
  created_at,
  updated_at
)
SELECT
  @ob_date,
  r.account_code,
  r.account_subhead,
  CASE WHEN r.amount > 0 THEN r.amount ELSE 0 END,
  CASE WHEN r.amount < 0 THEN ABS(r.amount) ELSE 0 END,
  LEFT(r.account_description, 300),
  CONCAT(
    'Opening Balance - Align bank ledger to ACTUAL - ',
    r.label,
    ' (system ', FORMAT(r.system_balance, 2),
    ', actual ', FORMAT(r.actual_balance, 2), ')'
  ),
  r.reference_number,
  'Opening Balance',
  LEFT(r.label, 50),
  r.bank_account_id,
  'bank',
  @created_by,
  @facility_id,
  'posted',
  'unmatched',
  'opening_balance',
  CONCAT(r.reference_number, '-BANK'),
  NOW(),
  NOW()
FROM tmp_bank_ob_resolved r
WHERE r.already_posted = 0
  AND ABS(r.amount) >= 0.005
  AND r.account_code IS NOT NULL
  AND IFNULL(r.match_count, 0) = 1
  AND @equity_code IS NOT NULL;

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
  mode_of_payment,
  created_by,
  facility_id,
  status,
  reconciled,
  type,
  transaction_ref,
  created_at,
  updated_at
)
SELECT
  @ob_date,
  eq.code,
  IFNULL(NULLIF(TRIM(eq.parent_code), ''), '0'),
  CASE WHEN r.amount < 0 THEN ABS(r.amount) ELSE 0 END,
  CASE WHEN r.amount > 0 THEN r.amount ELSE 0 END,
  LEFT(eq.description, 300),
  CONCAT(
    'Opening Balance Equity offset - Align bank ledger to ACTUAL - ',
    r.label
  ),
  r.reference_number,
  'Opening Balance',
  '',
  NULL,
  NULL,
  @created_by,
  @facility_id,
  'posted',
  'unmatched',
  'opening_balance',
  CONCAT(r.reference_number, '-EQUITY'),
  NOW(),
  NOW()
FROM tmp_bank_ob_resolved r
INNER JOIN account_category eq
  ON eq.facility_id = @facility_id
 AND eq.code = @equity_code
WHERE r.already_posted = 0
  AND ABS(r.amount) >= 0.005
  AND r.account_code IS NOT NULL
  AND IFNULL(r.match_count, 0) = 1;

SELECT
  reference_number,
  ROUND(SUM(dr), 2) AS total_dr,
  ROUND(SUM(cr), 2) AS total_cr,
  ROUND(SUM(dr) - SUM(cr), 2) AS out_of_balance
FROM general_ledger
WHERE facility_id = @facility_id
  AND reference_number LIKE CONCAT(@batch, '-%')
  AND type = 'opening_balance'
GROUP BY reference_number
ORDER BY reference_number;

SELECT
  r.label,
  r.system_balance,
  r.actual_balance,
  r.amount AS posted_opening_balance,
  ROUND(IFNULL((
    SELECT SUM(gl.dr - gl.cr)
    FROM general_ledger gl
    WHERE gl.facility_id = @facility_id
      AND gl.account_code = r.account_code
      AND IFNULL(gl.status, '') <> 'reversed'
  ), 0), 2) AS ledger_after_post,
  ROUND(
    IFNULL((
      SELECT SUM(gl.dr - gl.cr)
      FROM general_ledger gl
      WHERE gl.facility_id = @facility_id
        AND gl.account_code = r.account_code
        AND IFNULL(gl.status, '') <> 'reversed'
    ), 0) - r.actual_balance
  , 2) AS still_off_actual
FROM tmp_bank_ob_resolved r
ORDER BY r.seq;

SELECT
  ROUND(SUM(CASE WHEN transaction_ref LIKE '%-BANK' THEN dr ELSE 0 END), 2) AS posted_bank_dr,
  ROUND(SUM(CASE WHEN transaction_ref LIKE '%-BANK' THEN cr ELSE 0 END), 2) AS posted_bank_cr,
  ROUND(SUM(CASE WHEN transaction_ref LIKE '%-EQUITY' THEN dr ELSE 0 END), 2) AS posted_equity_dr,
  ROUND(SUM(CASE WHEN transaction_ref LIKE '%-EQUITY' THEN cr ELSE 0 END), 2) AS posted_equity_cr,
  COUNT(*) AS ledger_lines
FROM general_ledger
WHERE facility_id = @facility_id
  AND reference_number LIKE CONCAT(@batch, '-%')
  AND type = 'opening_balance';

-- Expected after a full post:
--   posted_bank_dr    = 63,676,481.34
--   posted_bank_cr    = 20,483,135.65
--   posted_equity_dr  = 20,483,135.65
--   posted_equity_cr  = 63,676,481.34
--   ledger_lines      = 30  (15 banks × 2)
--   still_off_actual  = 0.00 on every row
--   ledger_after_post = ACTUAL for every bank

COMMIT;

-- If the verify figures are wrong:
-- ROLLBACK;

-- To reverse this batch later:
-- DELETE FROM general_ledger
--  WHERE facility_id = '094c6e1e-dd07-48c4-a344-6e9d58cd7861'
--    AND type = 'opening_balance'
--    AND reference_number LIKE 'OB-BRK-%';
