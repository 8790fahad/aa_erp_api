-- Update general_ledger type column to include 'receivable'
ALTER TABLE general_ledger
MODIFY COLUMN type ENUM(
  'expenses',
  'bank',
  'payable',
  'prepayment',
  'accrued',
  'tax',
  'inventory',
  'receivable',
  'revenue'
) NOT NULL;

-- Verify the change
DESCRIBE general_ledger;
