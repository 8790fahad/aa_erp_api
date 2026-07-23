-- P&L fix: Cost of Sales, Other Income, Taxation (UNITED GASES LTD)
-- Facility: 2f93950a-f056-4a70-840a-74dc75c8dd41 | Period: 2026-01-01 to 2026-05-31
-- Import AFTER account_category (26)+(27) and seed_general_ledger_reports.sql
--
-- WHY lines were zero on Income Statement:
--   Cost of Sales  → needs account_category.type = 'Cost of sales' (note groups 500002, 500011)
--   Other Income   → needs GL credits on 400090–400093 (Non-operating revenue)
--   Taxation       → needs account_category.type = 'Taxes' + GL on tax expense accounts
--
-- Existing seed already posts ~₦200M to 500003–500031; reclassifying 500002/500011 moves that to Cost of Sales.

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

-- ── 1. Reclassify note groups so material + manufacturing hit Cost of Sales on P&L ──
UPDATE `account_category`
SET `type` = 'Cost of sales'
WHERE `facility_id` = '2f93950a-f056-4a70-840a-74dc75c8dd41'
  AND `code` IN ('500002', '500011');

-- ── 2. Add Taxation note group (no Taxes expense header existed for this facility) ──
INSERT INTO `account_category`
  (`code`, `parent_code`, `level`, `category`, `type`, `description`, `account_nature`, `facility_id`, `is_active`, `display`, `created_at`, `updated_at`, `subcategory`)
VALUES
  ('500080', '500001', 2, 'Expenses', 'Taxes', 'TAXATION', 'EXPENSE', '2f93950a-f056-4a70-840a-74dc75c8dd41', 1, 0, NOW(), NOW(), 'income_tax'),
  ('500081', '500080', 2, 'Expenses', 'Taxes', 'COMPANY INCOME TAX', 'EXPENSE', '2f93950a-f056-4a70-840a-74dc75c8dd41', 1, 1, NOW(), NOW(), 'income_tax'),
  ('500082', '500080', 2, 'Expenses', 'Taxes', 'EDUCATION TAX (TERTIARY)', 'EXPENSE', '2f93950a-f056-4a70-840a-74dc75c8dd41', 1, 1, NOW(), NOW(), 'education_tax')
ON DUPLICATE KEY UPDATE
  `type` = VALUES(`type`),
  `description` = VALUES(`description`),
  `subcategory` = VALUES(`subcategory`),
  `display` = VALUES(`display`);

INSERT INTO `general_ledger` (
  `transaction_date`, `account_code`, `account_subhead`,
  `dr`, `cr`, `account_description`, `transaction_description`,
  `reference_number`, `purpose_of_payment`, `payee`, `bank_account_id`,
  `cheque_no`, `mode_of_payment`, `created_by`, `facility_id`,
  `created_at`, `updated_at`, `updated_by`, `status`, `reconciled`,
  `type`, `transaction_ref`, `project_id`
) VALUES
-- ── 3. Other Income (CR revenue / DR bank) ──
('2026-02-15', '100040', '100039', 2850000.00, 0.00, 'CURRENT ACCOUNT - UNION BANK - BELLO RD', 'Sundry receipt - misc income', 'OIN-000001', 'Other income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'bank', 'OIN-000001', NULL),
('2026-02-15', '400090', '400089', 0.00, 2850000.00, 'SUNDRY RECEIPTS', 'Sundry receipt - misc income', 'OIN-000001', 'Other income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'revenue', 'OIN-000001', NULL),

('2026-03-20', '100043', '100039', 1842500.00, 0.00, 'UBA BANK PLC', 'Interest receivable on deposit', 'OIN-000002', 'Interest income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'bank', 'OIN-000002', NULL),
('2026-03-20', '400091', '400089', 0.00, 1842500.00, 'INTEREST RECEIVABLE', 'Interest receivable on deposit', 'OIN-000002', 'Interest income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'revenue', 'OIN-000002', NULL),

('2026-04-08', '100042', '100039', 975000.00, 0.00, 'CURRENT ACCOUNT - FIDELITY BANK PLC', 'Profit on disposal of fixed asset', 'OIN-000003', 'Asset disposal gain', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'bank', 'OIN-000003', NULL),
('2026-04-08', '400092', '400089', 0.00, 975000.00, 'PROFIT ON SALES OF FIXED ASSETS', 'Profit on disposal of fixed asset', 'OIN-000003', 'Asset disposal gain', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'revenue', 'OIN-000003', NULL),

('2026-05-12', '100044', '100039', 462500.00, 0.00, 'WEMA BANK PLC', 'Insurance claim recovery', 'OIN-000004', 'Other income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'bank', 'OIN-000004', NULL),
('2026-05-12', '400093', '400089', 0.00, 462500.00, 'ASSETS DISPOSAL', 'Insurance claim recovery', 'OIN-000004', 'Other income', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'revenue', 'OIN-000004', NULL),

-- ── 4. Taxation (DR expense / CR tax liability) ──
('2026-05-31', '500081', '500080', 1450000.00, 0.00, 'COMPANY INCOME TAX', 'Company income tax provision Q1-Q2 2026', 'TAX-000001', 'Income tax provision', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'expenses', 'TAX-000001', NULL),
('2026-05-31', '200090', '200083', 0.00, 1450000.00, 'TAXATION / COMPANY TAX', 'Company income tax provision Q1-Q2 2026', 'TAX-000001', 'Income tax provision', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'accrued', 'TAX-000001', NULL),

('2026-05-31', '500082', '500080', 267000.00, 0.00, 'EDUCATION TAX (TERTIARY)', 'Education tax provision 2026', 'TAX-000002', 'Education tax', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'expenses', 'TAX-000002', NULL),
('2026-05-31', '200090', '200083', 0.00, 267000.00, 'TAXATION / COMPANY TAX', 'Education tax provision 2026', 'TAX-000002', 'Education tax', NULL, NULL, '', 'bank', 'seed-user', '2f93950a-f056-4a70-840a-74dc75c8dd41', NOW(), '0000-00-00 00:00:00', NULL, 'paid', 'unmatched', 'accrued', 'TAX-000002', NULL);

COMMIT;

-- Expected P&L impact (approximate, with main seed):
--   Cost of Sales     ~ 200,180,790  (existing 500003–500031 after COA update)
--   Other Income      ~   6,130,000  (this file)
--   Taxation          ~   1,717,000  (this file)
--   Administrative    ~ 119,037,987  (500032+ after COS moved out)
