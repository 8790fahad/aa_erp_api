-- SQL queries to manually update the AaErp HR Module Database

-- 1. Create the loans table
CREATE TABLE IF NOT EXISTS `loans` (
  `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `employeeId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `facilityId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `purpose` VARCHAR(255) NOT NULL,
  `repaymentMethod` ENUM('Self', 'Salary Deduction') DEFAULT 'Salary Deduction',
  `status` ENUM('Pending', 'Approved', 'Repaying', 'Paid Off', 'Rejected') DEFAULT 'Pending',
  `monthlyDeductionAmount` DECIMAL(10,2) DEFAULT NULL,
  `durationMonths` INT NOT NULL,
  `amountPaid` DECIMAL(10,2) DEFAULT 0.00,
  `startDate` DATETIME DEFAULT NULL,
  `createdBy` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `updatedBy` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2. Add 'paymentType' to salary_structures table for Hourly and Daily wage calculations
ALTER TABLE `salary_structures`
ADD COLUMN `paymentType` ENUM('Monthly', 'Hourly', 'Daily') NOT NULL DEFAULT 'Monthly';

-- 3. Create the loan_repayments table for tracking individual deductions and manual payments
CREATE TABLE IF NOT EXISTS `loan_repayments` (
  `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `loanId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `facilityId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `paymentDate` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paymentMethod` ENUM('Manual', 'Payroll Deduction') NOT NULL,
  `reference` VARCHAR(255) DEFAULT NULL,
  `createdBy` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  FOREIGN KEY (`loanId`) REFERENCES `loans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4. Add JSON breakdown columns to payroll table
ALTER TABLE `payroll`
ADD COLUMN `allowance_details` JSON DEFAULT NULL,
ADD COLUMN `deduction_details` JSON DEFAULT NULL,
ADD COLUMN `bonus_details` JSON DEFAULT NULL,
ADD COLUMN `bonuses` DECIMAL(15,2) NOT NULL DEFAULT 0.00;

-- 5. Add employeeId to allowances table for individual assignments
ALTER TABLE `allowances`
ADD COLUMN `employeeId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

-- 6. Add paymentType and paymentNote to payroll table
--    paymentType: tracks whether this payroll record was computed as Monthly / Daily / Hourly
--    paymentNote: human-readable summary of the rate calculation (e.g. "Daily rate ₦5000 × 18 days")
ALTER TABLE `payroll`
ADD COLUMN IF NOT EXISTS `paymentType` ENUM('Monthly', 'Daily', 'Hourly') NOT NULL DEFAULT 'Monthly',
ADD COLUMN IF NOT EXISTS `paymentNote` VARCHAR(255) DEFAULT NULL;

-- 7. Extend general_ledger `type` ENUM to include payroll-specific types
--    'expenses' already exists and is used for DR salary lines
--    'payable'  already exists and is used for CR liability lines (PAYE, Pension, etc.)
--    'journal_entry' already exists and is used for reversals
--    No schema change needed — payroll accounting uses only existing valid ENUM values.
--    (This comment serves as documentation of the mapping.)

-- 8. Add salary status fields to employees table
ALTER TABLE `employees`
ADD COLUMN IF NOT EXISTS `salaryStatus` ENUM('Active', 'Stopped') NOT NULL DEFAULT 'Active',
ADD COLUMN IF NOT EXISTS `salaryStatusReason` TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS `salaryStatusDate` DATETIME DEFAULT NULL;

-- 9. Create salary_status_history table for audit trail
CREATE TABLE IF NOT EXISTS `salary_status_history` (
  `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `employeeId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `facilityId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `status` ENUM('Active', 'Stopped') NOT NULL,
  `reason` TEXT NOT NULL,
  `date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `performedBy` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 10. Add bank payment schedule template feature
ALTER TABLE `bank_accounts`
ADD COLUMN IF NOT EXISTS `payroll_template` LONGTEXT DEFAULT NULL;

-- 11. impress — imprest / direct expense (DE) posting history (paired with general_ledger + invoices)
CREATE TABLE IF NOT EXISTS `impress` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `facility_id` VARCHAR(50) NOT NULL,
  `ref_number` VARCHAR(50) NOT NULL,
  `reference_display` VARCHAR(80) DEFAULT NULL,
  `user_id` VARCHAR(100) DEFAULT NULL,
  `transaction_date` DATE NOT NULL,
  `remark` TEXT,
  `mode_of_payment` VARCHAR(20) NOT NULL,
  `cheque_number` VARCHAR(50) DEFAULT NULL,
  `total_expense` DECIMAL(20, 2) NOT NULL,
  `total_vat` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
  `total_payment` DECIMAL(20, 2) NOT NULL,
  `line_count` INT NOT NULL DEFAULT 1,
  `lines_json` JSON DEFAULT NULL,
  `payment_meta_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_impress_facility_ref` (`facility_id`, `ref_number`),
  KEY `idx_impress_facility_date` (`facility_id`, `transaction_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Add departmentId to store_entries to track department-specific stock
ALTER TABLE `store_entries`
ADD COLUMN IF NOT EXISTS `departmentId` INT DEFAULT NULL;

-- 13. Update sales_dep view to include departmentId from store_entries
CREATE OR REPLACE VIEW sales_dep AS
WITH latest_prices AS (
  SELECT
    se.product_id,
    se.branch_name,
    se.selling_price,
    se.expiry_date,
    ROW_NUMBER() OVER (
      PARTITION BY se.product_id
      ORDER BY se.expiry_date DESC, se.id DESC
    ) AS rn
  FROM store_entries se
  WHERE se.branch_name = 'for sales'
)
SELECT
  p.sku,
  p.name                                           AS item_name,
  CONCAT(p.category, ' (', p.unit_of_measure, ')') AS uom_category,
  p.unit_of_measure                                AS uom,
  p.taxable,
  COALESCE(se.product_id, p.sku)                   AS product_id,
  COALESCE(se.facilityId, p.facility_id)           AS facilityId,
  COALESCE(lp.selling_price, p.selling_price, 0)   AS selling_price,
  se.expiry_date,
  COALESCE(pm.multiplier_type)                     AS multiplier_type,
  se.multiplier_id,
  COALESCE(SUM(se.qty_in - se.qty_out), 0)         AS balance,
  p.unit_of_measure                                AS unit_of_measure,
  COALESCE(se.branch_name, 'for sales')            AS branch_name,
  se.departmentId
FROM
  products p
  LEFT JOIN store_entries se
    ON se.product_id = p.sku
    AND se.branch_name = 'for sales'
  LEFT JOIN product_multipliers pm
    ON se.multiplier_id = pm.id
  LEFT JOIN latest_prices lp
    ON lp.product_id = p.sku
    AND lp.rn = 1
WHERE
  p.status = 'Active'
GROUP BY
  p.sku,
  se.product_id,
  se.multiplier_id,
  p.name,
  p.category,
  p.unit_of_measure,
  p.taxable,
  p.facility_id,
  p.selling_price,
  se.facilityId,
  lp.selling_price,
  se.expiry_date,
  pm.multiplier_type,
  se.branch_name,
  se.departmentId
ORDER BY
  p.name,
  se.expiry_date;

