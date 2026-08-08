-- ============================================================
-- AA ERP — Indexes & constraints (add only if not exists)
-- Safe for production re-run
-- Fixes #1067 by relaxing sql_mode during ALTER (zero dates)
-- ============================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SESSION.sql_mode;
-- Clear strict / NO_ZERO_DATE so ALTER TABLE does not fail on legacy updated_at defaults (#1067)
SET SESSION sql_mode = '';

DELIMITER $$

DROP PROCEDURE IF EXISTS ensure_aa_erp_indexes $$
CREATE PROCEDURE ensure_aa_erp_indexes()
BEGIN
  DECLARE dbname VARCHAR(64);
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    -- Skip failed ALTER (e.g. table missing / incompatible) and continue
    SET @aa_erp_index_errors = IFNULL(@aa_erp_index_errors, 0) + 1;
  END;

  SET dbname = DATABASE();
  SET @aa_erp_index_errors = 0;
  SET SESSION sql_mode = '';

  -- PRIMARY assets.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `assets` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE assets.asset_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'asset_code'
  ) THEN
    ALTER TABLE `assets` ADD UNIQUE KEY `asset_code` (`asset_code`);
  END IF;

  -- INDEX assets.custodianId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'custodianId'
  ) THEN
    ALTER TABLE `assets` ADD KEY `custodianId` (`custodianId`);
  END IF;

  -- INDEX assets.createdBy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'createdBy'
  ) THEN
    ALTER TABLE `assets` ADD KEY `createdBy` (`createdBy`);
  END IF;

  -- INDEX assets.updatedBy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND INDEX_NAME = 'updatedBy'
  ) THEN
    ALTER TABLE `assets` ADD KEY `updatedBy` (`updatedBy`);
  END IF;

  -- PRIMARY asset_maintenance.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX asset_maintenance.asset_maintenance_asset_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND INDEX_NAME = 'asset_maintenance_asset_id'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD KEY `asset_maintenance_asset_id` (`assetId`);
  END IF;

  -- INDEX asset_maintenance.asset_maintenance_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND INDEX_NAME = 'asset_maintenance_facility_id'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD KEY `asset_maintenance_facility_id` (`facilityId`);
  END IF;

  -- INDEX asset_maintenance.asset_maintenance_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND INDEX_NAME = 'asset_maintenance_status'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD KEY `asset_maintenance_status` (`status`);
  END IF;

  -- INDEX asset_maintenance.asset_maintenance_scheduled_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND INDEX_NAME = 'asset_maintenance_scheduled_date'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD KEY `asset_maintenance_scheduled_date` (`scheduledDate`);
  END IF;

  -- INDEX asset_maintenance.asset_maintenance_priority
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_maintenance'
      AND INDEX_NAME = 'asset_maintenance_priority'
  ) THEN
    ALTER TABLE `asset_maintenance` ADD KEY `asset_maintenance_priority` (`priority`);
  END IF;

  -- PRIMARY asset_transactions.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `asset_transactions` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX asset_transactions.asset_transactions_asset_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND INDEX_NAME = 'asset_transactions_asset_id'
  ) THEN
    ALTER TABLE `asset_transactions` ADD KEY `asset_transactions_asset_id` (`assetId`);
  END IF;

  -- INDEX asset_transactions.asset_transactions_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND INDEX_NAME = 'asset_transactions_facility_id'
  ) THEN
    ALTER TABLE `asset_transactions` ADD KEY `asset_transactions_facility_id` (`facilityId`);
  END IF;

  -- INDEX asset_transactions.asset_transactions_transaction_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND INDEX_NAME = 'asset_transactions_transaction_type'
  ) THEN
    ALTER TABLE `asset_transactions` ADD KEY `asset_transactions_transaction_type` (`transactionType`);
  END IF;

  -- INDEX asset_transactions.asset_transactions_transaction_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND INDEX_NAME = 'asset_transactions_transaction_date'
  ) THEN
    ALTER TABLE `asset_transactions` ADD KEY `asset_transactions_transaction_date` (`transactionDate`);
  END IF;

  -- INDEX asset_transactions.asset_transactions_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'asset_transactions'
      AND INDEX_NAME = 'asset_transactions_status'
  ) THEN
    ALTER TABLE `asset_transactions` ADD KEY `asset_transactions_status` (`status`);
  END IF;

  -- PRIMARY attendance.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'attendance'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `attendance` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bank_accounts.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_accounts'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_accounts` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bank_discrepancies.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_discrepancies'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_discrepancies` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX bank_discrepancies.bank_account_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_discrepancies'
      AND INDEX_NAME = 'bank_account_id'
  ) THEN
    ALTER TABLE `bank_discrepancies` ADD KEY `bank_account_id` (`bank_account_id`);
  END IF;

  -- INDEX bank_discrepancies.bank_transaction_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_discrepancies'
      AND INDEX_NAME = 'bank_transaction_id'
  ) THEN
    ALTER TABLE `bank_discrepancies` ADD KEY `bank_transaction_id` (`bank_transaction_id`);
  END IF;

  -- INDEX bank_discrepancies.ledger_transaction_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_discrepancies'
      AND INDEX_NAME = 'ledger_transaction_id'
  ) THEN
    ALTER TABLE `bank_discrepancies` ADD KEY `ledger_transaction_id` (`ledger_transaction_id`);
  END IF;

  -- PRIMARY bank_list.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_list'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_list` ADD PRIMARY KEY (`bank_code`,`bank_cbn_code`,`facilityId`);
  END IF;

  -- INDEX bank_list.id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_list'
      AND INDEX_NAME = 'id'
  ) THEN
    ALTER TABLE `bank_list` ADD KEY `id` (`id`);
  END IF;

  -- PRIMARY bank_matching_rules.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_matching_rules'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_matching_rules` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bank_reconciliation.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_reconciliation'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_reconciliation` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bank_statements.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_statements'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_statements` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX bank_statements.bank_account_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_statements'
      AND INDEX_NAME = 'bank_account_id'
  ) THEN
    ALTER TABLE `bank_statements` ADD KEY `bank_account_id` (`bank_account_id`);
  END IF;

  -- PRIMARY bank_statement_transactions.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_statement_transactions'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bank_statement_transactions` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX bank_statement_transactions.bank_statement_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bank_statement_transactions'
      AND INDEX_NAME = 'bank_statement_id'
  ) THEN
    ALTER TABLE `bank_statement_transactions` ADD KEY `bank_statement_id` (`bank_statement_id`);
  END IF;

  -- PRIMARY bill_of_materials.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bill_of_materials'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bill_of_materials` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bill_of_material_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bill_of_material_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bill_of_material_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY bonuses.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bonuses'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `bonuses` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX bonuses.bonuses_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bonuses'
      AND INDEX_NAME = 'bonuses_facility_id'
  ) THEN
    ALTER TABLE `bonuses` ADD KEY `bonuses_facility_id` (`facilityId`);
  END IF;

  -- INDEX bonuses.bonuses_employee_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bonuses'
      AND INDEX_NAME = 'bonuses_employee_id'
  ) THEN
    ALTER TABLE `bonuses` ADD KEY `bonuses_employee_id` (`employeeId`);
  END IF;

  -- INDEX bonuses.bonuses_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bonuses'
      AND INDEX_NAME = 'bonuses_status'
  ) THEN
    ALTER TABLE `bonuses` ADD KEY `bonuses_status` (`status`);
  END IF;

  -- INDEX bonuses.bonuses_bonus_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'bonuses'
      AND INDEX_NAME = 'bonuses_bonus_date'
  ) THEN
    ALTER TABLE `bonuses` ADD KEY `bonuses_bonus_date` (`bonusDate`);
  END IF;

  -- PRIMARY branches.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'branches'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `branches` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX branches.fk_admin
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'branches'
      AND INDEX_NAME = 'fk_admin'
  ) THEN
    ALTER TABLE `branches` ADD KEY `fk_admin` (`admin`);
  END IF;

  -- INDEX branches.fk_created_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'branches'
      AND INDEX_NAME = 'fk_created_by'
  ) THEN
    ALTER TABLE `branches` ADD KEY `fk_created_by` (`created_by`);
  END IF;

  -- PRIMARY branch_requisition.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'branch_requisition'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `branch_requisition` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY budget.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'budget'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `budget` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY business.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'business'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `business` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE business.marketplace_slug
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'business'
      AND INDEX_NAME = 'marketplace_slug'
  ) THEN
    ALTER TABLE `business` ADD UNIQUE KEY `marketplace_slug` (`marketplace_slug`);
  END IF;

  -- UNIQUE business.link_user
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'business'
      AND INDEX_NAME = 'link_user'
  ) THEN
    ALTER TABLE `business` ADD UNIQUE KEY `link_user` (`link_user`);
  END IF;

  -- PRIMARY cash_transfers.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `cash_transfers` ADD PRIMARY KEY (`transfer_id`);
  END IF;

  -- UNIQUE cash_transfers.transfer_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'transfer_id'
  ) THEN
    ALTER TABLE `cash_transfers` ADD UNIQUE KEY `transfer_id` (`transfer_id`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_transfer_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_transfer_id'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_transfer_id` (`transfer_id`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_facility_id'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_facility_id` (`facilityId`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_status'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_status` (`status`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_created_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_created_by'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_created_by` (`created_by`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_from_account
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_from_account'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_from_account` (`from_account`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_to_account
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_to_account'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_to_account` (`to_account`);
  END IF;

  -- INDEX cash_transfers.cash_transfers_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'cash_transfers'
      AND INDEX_NAME = 'cash_transfers_date'
  ) THEN
    ALTER TABLE `cash_transfers` ADD KEY `cash_transfers_date` (`date`);
  END IF;

  -- PRIMARY category.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'category'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `category` ADD PRIMARY KEY (`ref`);
  END IF;

  -- PRIMARY comment.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'comment'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `comment` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY credit_note_applications.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'credit_note_applications'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `credit_note_applications` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX credit_note_applications.idx_cn_app_facility_cn
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'credit_note_applications'
      AND INDEX_NAME = 'idx_cn_app_facility_cn'
  ) THEN
    ALTER TABLE `credit_note_applications` ADD KEY `idx_cn_app_facility_cn` (`facility_id`,`credit_note_number`);
  END IF;

  -- INDEX credit_note_applications.idx_cn_app_facility_inv
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'credit_note_applications'
      AND INDEX_NAME = 'idx_cn_app_facility_inv'
  ) THEN
    ALTER TABLE `credit_note_applications` ADD KEY `idx_cn_app_facility_inv` (`facility_id`,`invoice_ref`);
  END IF;

  -- PRIMARY customers.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customers'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customers` ADD PRIMARY KEY (`customerNo`,`facilityId`);
  END IF;

  -- INDEX customers.facilityId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customers'
      AND INDEX_NAME = 'facilityId'
  ) THEN
    ALTER TABLE `customers` ADD KEY `facilityId` (`facilityId`);
  END IF;

  -- INDEX customers.created_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customers'
      AND INDEX_NAME = 'created_by'
  ) THEN
    ALTER TABLE `customers` ADD KEY `created_by` (`created_by`);
  END IF;

  -- INDEX customers.account_head
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customers'
      AND INDEX_NAME = 'account_head'
  ) THEN
    ALTER TABLE `customers` ADD KEY `account_head` (`account_head`);
  END IF;

  -- INDEX customers.idx_customers_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customers'
      AND INDEX_NAME = 'idx_customers_branch_id'
  ) THEN
    ALTER TABLE `customers` ADD KEY `idx_customers_branch_id` (`branch_id`);
  END IF;

  -- PRIMARY customer_addresses.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_addresses'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_addresses` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX customer_addresses.customer_addresses_facility_id_customer_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_addresses'
      AND INDEX_NAME = 'customer_addresses_facility_id_customer_no'
  ) THEN
    ALTER TABLE `customer_addresses` ADD KEY `customer_addresses_facility_id_customer_no` (`facility_id`,`customer_no`);
  END IF;

  -- INDEX customer_addresses.customer_addresses_address_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_addresses'
      AND INDEX_NAME = 'customer_addresses_address_type'
  ) THEN
    ALTER TABLE `customer_addresses` ADD KEY `customer_addresses_address_type` (`address_type`);
  END IF;

  -- PRIMARY customer_contacts.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_contacts'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_contacts` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX customer_contacts.customer_contacts_facility_id_customer_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_contacts'
      AND INDEX_NAME = 'customer_contacts_facility_id_customer_no'
  ) THEN
    ALTER TABLE `customer_contacts` ADD KEY `customer_contacts_facility_id_customer_no` (`facility_id`,`customer_no`);
  END IF;

  -- INDEX customer_contacts.customer_contacts_is_primary
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_contacts'
      AND INDEX_NAME = 'customer_contacts_is_primary'
  ) THEN
    ALTER TABLE `customer_contacts` ADD KEY `customer_contacts_is_primary` (`is_primary`);
  END IF;

  -- PRIMARY customer_copy.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_copy'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_copy` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY customer_entries.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_entries'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_entries` ADD PRIMARY KEY (`entry_id`);
  END IF;

  -- INDEX customer_entries.facilityId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_entries'
      AND INDEX_NAME = 'facilityId'
  ) THEN
    ALTER TABLE `customer_entries` ADD KEY `facilityId` (`facilityId`);
  END IF;

  -- INDEX customer_entries.created_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_entries'
      AND INDEX_NAME = 'created_by'
  ) THEN
    ALTER TABLE `customer_entries` ADD KEY `created_by` (`created_by`);
  END IF;

  -- INDEX customer_entries.idx_customer_entries_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_entries'
      AND INDEX_NAME = 'idx_customer_entries_branch_id'
  ) THEN
    ALTER TABLE `customer_entries` ADD KEY `idx_customer_entries_branch_id` (`branch_id`);
  END IF;

  -- PRIMARY customer_security_deposits.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD PRIMARY KEY (`deposit_id`);
  END IF;

  -- UNIQUE customer_security_deposits.reference_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND INDEX_NAME = 'reference_number'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD UNIQUE KEY `reference_number` (`reference_number`);
  END IF;

  -- UNIQUE customer_security_deposits.customer_security_deposits_reference_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND INDEX_NAME = 'customer_security_deposits_reference_number'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD UNIQUE KEY `customer_security_deposits_reference_number` (`reference_number`);
  END IF;

  -- INDEX customer_security_deposits.customer_security_deposits_customer_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND INDEX_NAME = 'customer_security_deposits_customer_no'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD KEY `customer_security_deposits_customer_no` (`customerNo`);
  END IF;

  -- INDEX customer_security_deposits.customer_security_deposits_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND INDEX_NAME = 'customer_security_deposits_facility_id'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD KEY `customer_security_deposits_facility_id` (`facilityId`);
  END IF;

  -- INDEX customer_security_deposits.customer_security_deposits_transaction_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_security_deposits'
      AND INDEX_NAME = 'customer_security_deposits_transaction_date'
  ) THEN
    ALTER TABLE `customer_security_deposits` ADD KEY `customer_security_deposits_transaction_date` (`transaction_date`);
  END IF;

  -- PRIMARY customer_types.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_types'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `customer_types` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE customer_types.unique_customer_type_name_per_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_types'
      AND INDEX_NAME = 'unique_customer_type_name_per_facility'
  ) THEN
    ALTER TABLE `customer_types` ADD UNIQUE KEY `unique_customer_type_name_per_facility` (`name`,`facilityId`);
  END IF;

  -- INDEX customer_types.idx_customer_types_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_types'
      AND INDEX_NAME = 'idx_customer_types_facility_id'
  ) THEN
    ALTER TABLE `customer_types` ADD KEY `idx_customer_types_facility_id` (`facilityId`);
  END IF;

  -- INDEX customer_types.idx_customer_types_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_types'
      AND INDEX_NAME = 'idx_customer_types_status'
  ) THEN
    ALTER TABLE `customer_types` ADD KEY `idx_customer_types_status` (`status`);
  END IF;

  -- INDEX customer_types.idx_customer_types_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'customer_types'
      AND INDEX_NAME = 'idx_customer_types_name'
  ) THEN
    ALTER TABLE `customer_types` ADD KEY `idx_customer_types_name` (`name`);
  END IF;

  -- PRIMARY Departments.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'Departments'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `Departments` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY discount_table.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `discount_table` ADD PRIMARY KEY (`discount_id`);
  END IF;

  -- UNIQUE discount_table.uq_discount_name_per_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND INDEX_NAME = 'uq_discount_name_per_facility'
  ) THEN
    ALTER TABLE `discount_table` ADD UNIQUE KEY `uq_discount_name_per_facility` (`facilityId`,`discount_name`);
  END IF;

  -- INDEX discount_table.idx_discount_facility_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND INDEX_NAME = 'idx_discount_facility_status'
  ) THEN
    ALTER TABLE `discount_table` ADD KEY `idx_discount_facility_status` (`facilityId`,`status`);
  END IF;

  -- INDEX discount_table.idx_discount_account_head_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND INDEX_NAME = 'idx_discount_account_head_facility'
  ) THEN
    ALTER TABLE `discount_table` ADD KEY `idx_discount_account_head_facility` (`discount_account_head`,`facilityId`);
  END IF;

  -- PRIMARY einvoicing_clients.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'einvoicing_clients'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `einvoicing_clients` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE einvoicing_clients.client_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'einvoicing_clients'
      AND INDEX_NAME = 'client_id'
  ) THEN
    ALTER TABLE `einvoicing_clients` ADD UNIQUE KEY `client_id` (`client_id`);
  END IF;

  -- UNIQUE einvoicing_clients.einvoicing_clients_business_env
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'einvoicing_clients'
      AND INDEX_NAME = 'einvoicing_clients_business_env'
  ) THEN
    ALTER TABLE `einvoicing_clients` ADD UNIQUE KEY `einvoicing_clients_business_env` (`business_id`,`environment`);
  END IF;

  -- UNIQUE einvoicing_clients.einvoicing_clients_kyc_env
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'einvoicing_clients'
      AND INDEX_NAME = 'einvoicing_clients_kyc_env'
  ) THEN
    ALTER TABLE `einvoicing_clients` ADD UNIQUE KEY `einvoicing_clients_kyc_env` (`kyc_user_id`,`environment`);
  END IF;

  -- INDEX einvoicing_clients.einvoicing_clients_kyc_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'einvoicing_clients'
      AND INDEX_NAME = 'einvoicing_clients_kyc_user_id'
  ) THEN
    ALTER TABLE `einvoicing_clients` ADD KEY `einvoicing_clients_kyc_user_id` (`kyc_user_id`);
  END IF;

  -- PRIMARY employees.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'employees'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `employees` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE employees.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'employees'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `employees` ADD UNIQUE KEY `employeeId` (`employeeId`);
  END IF;

  -- UNIQUE employees.employees_facility_id_employee_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'employees'
      AND INDEX_NAME = 'employees_facility_id_employee_id'
  ) THEN
    ALTER TABLE `employees` ADD UNIQUE KEY `employees_facility_id_employee_id` (`facilityId`,`employeeId`);
  END IF;

  -- PRIMARY employee_paye_profiles.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'employee_paye_profiles'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `employee_paye_profiles` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE employee_paye_profiles.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'employee_paye_profiles'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `employee_paye_profiles` ADD UNIQUE KEY `employeeId` (`employeeId`);
  END IF;

  -- PRIMARY estimates.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'estimates'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `estimates` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY expense.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'expense'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `expense` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY feedbacks.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'feedbacks'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `feedbacks` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY finished_goods.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'finished_goods'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `finished_goods` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX finished_goods.production_order_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'finished_goods'
      AND INDEX_NAME = 'production_order_id'
  ) THEN
    ALTER TABLE `finished_goods` ADD KEY `production_order_id` (`production_order_id`);
  END IF;

  -- PRIMARY general_ledger.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'general_ledger'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `general_ledger` ADD PRIMARY KEY (`transaction_id`);
  END IF;

  -- INDEX general_ledger.account_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'general_ledger'
      AND INDEX_NAME = 'account_code'
  ) THEN
    ALTER TABLE `general_ledger` ADD KEY `account_code` (`account_code`,`account_subhead`);
  END IF;

  -- INDEX general_ledger.account_sub_code_fk
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'general_ledger'
      AND INDEX_NAME = 'account_sub_code_fk'
  ) THEN
    ALTER TABLE `general_ledger` ADD KEY `account_sub_code_fk` (`account_subhead`);
  END IF;

  -- INDEX general_ledger.idx_general_ledger_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'general_ledger'
      AND INDEX_NAME = 'idx_general_ledger_branch_id'
  ) THEN
    ALTER TABLE `general_ledger` ADD KEY `idx_general_ledger_branch_id` (`branch_id`);
  END IF;

  -- PRIMARY gl_journal_batches.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_journal_batches'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `gl_journal_batches` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE gl_journal_batches.idempotencyKey
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_journal_batches'
      AND INDEX_NAME = 'idempotencyKey'
  ) THEN
    ALTER TABLE `gl_journal_batches` ADD UNIQUE KEY `idempotencyKey` (`idempotencyKey`);
  END IF;

  -- UNIQUE gl_journal_batches.gl_journal_batches_idempotency_key
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_journal_batches'
      AND INDEX_NAME = 'gl_journal_batches_idempotency_key'
  ) THEN
    ALTER TABLE `gl_journal_batches` ADD UNIQUE KEY `gl_journal_batches_idempotency_key` (`idempotencyKey`);
  END IF;

  -- PRIMARY gl_journal_lines.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_journal_lines'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `gl_journal_lines` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX gl_journal_lines.batchId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_journal_lines'
      AND INDEX_NAME = 'batchId'
  ) THEN
    ALTER TABLE `gl_journal_lines` ADD KEY `batchId` (`batchId`);
  END IF;

  -- PRIMARY gl_periods.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'gl_periods'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `gl_periods` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY goods_received_notes.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_received_notes'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `goods_received_notes` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE goods_received_notes.grn_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_received_notes'
      AND INDEX_NAME = 'grn_number'
  ) THEN
    ALTER TABLE `goods_received_notes` ADD UNIQUE KEY `grn_number` (`grn_number`);
  END IF;

  -- INDEX goods_received_notes.po_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_received_notes'
      AND INDEX_NAME = 'po_id'
  ) THEN
    ALTER TABLE `goods_received_notes` ADD KEY `po_id` (`po_id`);
  END IF;

  -- PRIMARY goods_transfers.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `goods_transfers` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE goods_transfers.transfer_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND INDEX_NAME = 'transfer_no'
  ) THEN
    ALTER TABLE `goods_transfers` ADD UNIQUE KEY `transfer_no` (`transfer_no`);
  END IF;

  -- INDEX goods_transfers.idx_gt_facility_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND INDEX_NAME = 'idx_gt_facility_status'
  ) THEN
    ALTER TABLE `goods_transfers` ADD KEY `idx_gt_facility_status` (`facility_id`,`status`);
  END IF;

  -- INDEX goods_transfers.idx_gt_source_branch
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND INDEX_NAME = 'idx_gt_source_branch'
  ) THEN
    ALTER TABLE `goods_transfers` ADD KEY `idx_gt_source_branch` (`source_branch_id`);
  END IF;

  -- INDEX goods_transfers.idx_gt_dest_branch
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND INDEX_NAME = 'idx_gt_dest_branch'
  ) THEN
    ALTER TABLE `goods_transfers` ADD KEY `idx_gt_dest_branch` (`destination_branch_id`);
  END IF;

  -- INDEX goods_transfers.idx_gt_transfer_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfers'
      AND INDEX_NAME = 'idx_gt_transfer_date'
  ) THEN
    ALTER TABLE `goods_transfers` ADD KEY `idx_gt_transfer_date` (`transfer_date`);
  END IF;

  -- PRIMARY goods_transfer_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfer_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `goods_transfer_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX goods_transfer_items.idx_gti_transfer_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfer_items'
      AND INDEX_NAME = 'idx_gti_transfer_id'
  ) THEN
    ALTER TABLE `goods_transfer_items` ADD KEY `idx_gti_transfer_id` (`transfer_id`);
  END IF;

  -- INDEX goods_transfer_items.idx_gti_product_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfer_items'
      AND INDEX_NAME = 'idx_gti_product_id'
  ) THEN
    ALTER TABLE `goods_transfer_items` ADD KEY `idx_gti_product_id` (`product_id`);
  END IF;

  -- PRIMARY grn_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'grn_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `grn_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY impress.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'impress'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `impress` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX impress.impress_facility_id_ref_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'impress'
      AND INDEX_NAME = 'impress_facility_id_ref_number'
  ) THEN
    ALTER TABLE `impress` ADD KEY `impress_facility_id_ref_number` (`facility_id`,`ref_number`);
  END IF;

  -- INDEX impress.impress_facility_id_transaction_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'impress'
      AND INDEX_NAME = 'impress_facility_id_transaction_date'
  ) THEN
    ALTER TABLE `impress` ADD KEY `impress_facility_id_transaction_date` (`facility_id`,`transaction_date`);
  END IF;

  -- PRIMARY inventory.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inventory'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `inventory` ADD PRIMARY KEY (`inventory_id`);
  END IF;

  -- PRIMARY inventory_valuation.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inventory_valuation'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `inventory_valuation` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX inventory_valuation.inventory_valuation_product_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inventory_valuation'
      AND INDEX_NAME = 'inventory_valuation_product_id'
  ) THEN
    ALTER TABLE `inventory_valuation` ADD KEY `inventory_valuation_product_id` (`product_id`);
  END IF;

  -- INDEX inventory_valuation.inventory_valuation_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inventory_valuation'
      AND INDEX_NAME = 'inventory_valuation_facility_id'
  ) THEN
    ALTER TABLE `inventory_valuation` ADD KEY `inventory_valuation_facility_id` (`facility_id`);
  END IF;

  -- PRIMARY invoices.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'invoices'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `invoices` ADD PRIMARY KEY (`invoice_id`);
  END IF;

  -- INDEX invoices.idx_invoices_branchId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_branchId'
  ) THEN
    ALTER TABLE `invoices` ADD KEY `idx_invoices_branchId` (`branchId`);
  END IF;

  -- INDEX invoices.idx_invoices_facility_branch_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_facility_branch_type'
  ) THEN
    ALTER TABLE `invoices` ADD KEY `idx_invoices_facility_branch_type` (`facility_id`,`branchId`,`type`);
  END IF;

  -- PRIMARY inv_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inv_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `inv_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY inv_layers.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'inv_layers'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `inv_layers` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY item_category.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_category'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `item_category` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY item_list.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_list'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `item_list` ADD PRIMARY KEY (`item_list_id`);
  END IF;

  -- INDEX item_list.memo_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_list'
      AND INDEX_NAME = 'memo_id'
  ) THEN
    ALTER TABLE `item_list` ADD KEY `memo_id` (`memo_id`);
  END IF;

  -- INDEX item_list.item_list_memo_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_list'
      AND INDEX_NAME = 'item_list_memo_id'
  ) THEN
    ALTER TABLE `item_list` ADD KEY `item_list_memo_id` (`memo_id`);
  END IF;

  -- INDEX item_list.item_list_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_list'
      AND INDEX_NAME = 'item_list_facility_id'
  ) THEN
    ALTER TABLE `item_list` ADD KEY `item_list_facility_id` (`facilityId`);
  END IF;

  -- INDEX item_list.item_list_item_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'item_list'
      AND INDEX_NAME = 'item_list_item_code'
  ) THEN
    ALTER TABLE `item_list` ADD KEY `item_list_item_code` (`item_code`);
  END IF;

  -- PRIMARY journal_entries.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'journal_entries'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `journal_entries` ADD PRIMARY KEY (`transaction_id`);
  END IF;

  -- PRIMARY justification.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'justification'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `justification` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY kyc_business_documents.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_documents'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_business_documents` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX kyc_business_documents.kyc_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_documents'
      AND INDEX_NAME = 'kyc_user_id'
  ) THEN
    ALTER TABLE `kyc_business_documents` ADD KEY `kyc_user_id` (`kyc_user_id`);
  END IF;

  -- PRIMARY kyc_business_information.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_information'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_business_information` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE kyc_business_information.kyc_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_information'
      AND INDEX_NAME = 'kyc_user_id'
  ) THEN
    ALTER TABLE `kyc_business_information` ADD UNIQUE KEY `kyc_user_id` (`kyc_user_id`);
  END IF;

  -- PRIMARY kyc_contact_information.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_contact_information'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_contact_information` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE kyc_contact_information.kyc_contact_information_user
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_contact_information'
      AND INDEX_NAME = 'kyc_contact_information_user'
  ) THEN
    ALTER TABLE `kyc_contact_information` ADD UNIQUE KEY `kyc_contact_information_user` (`kyc_user_id`);
  END IF;

  -- PRIMARY kyc_service_settings.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_service_settings'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_service_settings` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE kyc_service_settings.kyc_service_settings_user_service
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_service_settings'
      AND INDEX_NAME = 'kyc_service_settings_user_service'
  ) THEN
    ALTER TABLE `kyc_service_settings` ADD UNIQUE KEY `kyc_service_settings_user_service` (`kyc_user_id`,`service`);
  END IF;

  -- PRIMARY kyc_stakeholders.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_stakeholders'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_stakeholders` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX kyc_stakeholders.kyc_stakeholders_user
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_stakeholders'
      AND INDEX_NAME = 'kyc_stakeholders_user'
  ) THEN
    ALTER TABLE `kyc_stakeholders` ADD KEY `kyc_stakeholders_user` (`kyc_user_id`);
  END IF;

  -- PRIMARY kyc_terms_acceptance.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_terms_acceptance'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_terms_acceptance` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE kyc_terms_acceptance.kyc_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_terms_acceptance'
      AND INDEX_NAME = 'kyc_user_id'
  ) THEN
    ALTER TABLE `kyc_terms_acceptance` ADD UNIQUE KEY `kyc_user_id` (`kyc_user_id`);
  END IF;

  -- PRIMARY kyc_users.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_users'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `kyc_users` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE kyc_users.email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_users'
      AND INDEX_NAME = 'email'
  ) THEN
    ALTER TABLE `kyc_users` ADD UNIQUE KEY `email` (`email`);
  END IF;

  -- UNIQUE kyc_users.kyc_users_email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_users'
      AND INDEX_NAME = 'kyc_users_email'
  ) THEN
    ALTER TABLE `kyc_users` ADD UNIQUE KEY `kyc_users_email` (`email`);
  END IF;

  -- PRIMARY leaves.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leaves'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `leaves` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX leaves.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leaves'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `leaves` ADD KEY `employeeId` (`employeeId`);
  END IF;

  -- PRIMARY leave_balances.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leave_balances'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `leave_balances` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX leave_balances.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leave_balances'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `leave_balances` ADD KEY `employeeId` (`employeeId`);
  END IF;

  -- PRIMARY leave_types.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leave_types'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `leave_types` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE leave_types.leave_types_code_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leave_types'
      AND INDEX_NAME = 'leave_types_code_facility_id'
  ) THEN
    ALTER TABLE `leave_types` ADD UNIQUE KEY `leave_types_code_facility_id` (`code`,`facilityId`);
  END IF;

  -- INDEX leave_types.leave_types_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'leave_types'
      AND INDEX_NAME = 'leave_types_facility_id'
  ) THEN
    ALTER TABLE `leave_types` ADD KEY `leave_types_facility_id` (`facilityId`);
  END IF;

  -- PRIMARY loans.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'loans'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `loans` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX loans.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'loans'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `loans` ADD KEY `employeeId` (`employeeId`);
  END IF;

  -- PRIMARY loan_repayments.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'loan_repayments'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `loan_repayments` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY loan_setups.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'loan_setups'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `loan_setups` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY logs.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'logs'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `logs` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY materials.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'materials'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `materials` ADD PRIMARY KEY (`collection_id`,`facility_id`);
  END IF;

  -- PRIMARY materials_collection.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'materials_collection'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `materials_collection` ADD PRIMARY KEY (`collection_id`,`facilityId`);
  END IF;

  -- PRIMARY materials_entries.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'materials_entries'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `materials_entries` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX materials_entries.collection_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'materials_entries'
      AND INDEX_NAME = 'collection_id'
  ) THEN
    ALTER TABLE `materials_entries` ADD KEY `collection_id` (`collection_id`);
  END IF;

  -- PRIMARY material_issuances.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_issuances'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `material_issuances` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY material_requisitions.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisitions'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `material_requisitions` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE material_requisitions.requisition_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisitions'
      AND INDEX_NAME = 'requisition_number'
  ) THEN
    ALTER TABLE `material_requisitions` ADD UNIQUE KEY `requisition_number` (`requisition_number`);
  END IF;

  -- INDEX material_requisitions.idx_mr_requesting_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisitions'
      AND INDEX_NAME = 'idx_mr_requesting_branch_id'
  ) THEN
    ALTER TABLE `material_requisitions` ADD KEY `idx_mr_requesting_branch_id` (`requesting_branch_id`);
  END IF;

  -- INDEX material_requisitions.idx_mr_source_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisitions'
      AND INDEX_NAME = 'idx_mr_source_branch_id'
  ) THEN
    ALTER TABLE `material_requisitions` ADD KEY `idx_mr_source_branch_id` (`source_branch_id`);
  END IF;

  -- PRIMARY material_requisition_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisition_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `material_requisition_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX material_requisition_items.requisition_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisition_items'
      AND INDEX_NAME = 'requisition_id'
  ) THEN
    ALTER TABLE `material_requisition_items` ADD KEY `requisition_id` (`requisition_id`);
  END IF;

  -- INDEX material_requisition_items.sku
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'material_requisition_items'
      AND INDEX_NAME = 'sku'
  ) THEN
    ALTER TABLE `material_requisition_items` ADD KEY `sku` (`sku`);
  END IF;

  -- PRIMARY membership.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'membership'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `membership` ADD PRIMARY KEY (`business_id`,`user_id`);
  END IF;

  -- INDEX membership.fk_business_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'membership'
      AND INDEX_NAME = 'fk_business_id'
  ) THEN
    ALTER TABLE `membership` ADD KEY `fk_business_id` (`business_id`);
  END IF;

  -- INDEX membership.fk_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'membership'
      AND INDEX_NAME = 'fk_user_id'
  ) THEN
    ALTER TABLE `membership` ADD KEY `fk_user_id` (`user_id`);
  END IF;

  -- INDEX membership.idx_membership_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'membership'
      AND INDEX_NAME = 'idx_membership_branch_id'
  ) THEN
    ALTER TABLE `membership` ADD KEY `idx_membership_branch_id` (`branch_id`);
  END IF;

  -- PRIMARY memo.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `memo` ADD PRIMARY KEY (`memo_id`,`facilityId`);
  END IF;

  -- INDEX memo.pr_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'pr_no'
  ) THEN
    ALTER TABLE `memo` ADD KEY `pr_no` (`pr_no`);
  END IF;

  -- INDEX memo.memo_memo_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_memo_id'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_memo_id` (`memo_id`);
  END IF;

  -- INDEX memo.memo_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_facility_id'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_facility_id` (`facilityId`);
  END IF;

  -- INDEX memo.memo_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_status'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_status` (`status`);
  END IF;

  -- INDEX memo.memo_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_user_id'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_user_id` (`user_id`);
  END IF;

  -- INDEX memo.memo_raise_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_raise_by'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_raise_by` (`raise_by`);
  END IF;

  -- INDEX memo.memo_pr_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo'
      AND INDEX_NAME = 'memo_pr_no'
  ) THEN
    ALTER TABLE `memo` ADD KEY `memo_pr_no` (`pr_no`);
  END IF;

  -- PRIMARY memo_documents.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'memo_documents'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `memo_documents` ADD PRIMARY KEY (`transaction_id`);
  END IF;

  -- PRIMARY mixtures.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'mixtures'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `mixtures` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE mixtures.reference_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'mixtures'
      AND INDEX_NAME = 'reference_number'
  ) THEN
    ALTER TABLE `mixtures` ADD UNIQUE KEY `reference_number` (`reference_number`);
  END IF;

  -- PRIMARY mixture_ingredients.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'mixture_ingredients'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `mixture_ingredients` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX mixture_ingredients.mixture_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'mixture_ingredients'
      AND INDEX_NAME = 'mixture_id'
  ) THEN
    ALTER TABLE `mixture_ingredients` ADD KEY `mixture_id` (`mixture_id`);
  END IF;

  -- PRIMARY nrs_einvoices.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'nrs_einvoices'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `nrs_einvoices` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE nrs_einvoices.nrs_einvoices_business_irn
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'nrs_einvoices'
      AND INDEX_NAME = 'nrs_einvoices_business_irn'
  ) THEN
    ALTER TABLE `nrs_einvoices` ADD UNIQUE KEY `nrs_einvoices_business_irn` (`business_id`,`irn`);
  END IF;

  -- PRIMARY number_generator.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'number_generator'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `number_generator` ADD PRIMARY KEY (`prefix`,`facilityId`);
  END IF;

  -- UNIQUE number_generator.number_generator_prefix_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'number_generator'
      AND INDEX_NAME = 'number_generator_prefix_facility_id'
  ) THEN
    ALTER TABLE `number_generator` ADD UNIQUE KEY `number_generator_prefix_facility_id` (`prefix`,`facilityId`);
  END IF;

  -- PRIMARY paye_settings.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'paye_settings'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `paye_settings` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE paye_settings.paye_settings_facility_id_assessment_year
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'paye_settings'
      AND INDEX_NAME = 'paye_settings_facility_id_assessment_year'
  ) THEN
    ALTER TABLE `paye_settings` ADD UNIQUE KEY `paye_settings_facility_id_assessment_year` (`facilityId`,`assessmentYear`);
  END IF;

  -- UNIQUE paye_settings.paye_settings_facility_year_unique
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'paye_settings'
      AND INDEX_NAME = 'paye_settings_facility_year_unique'
  ) THEN
    ALTER TABLE `paye_settings` ADD UNIQUE KEY `paye_settings_facility_year_unique` (`facilityId`,`assessmentYear`);
  END IF;

  -- PRIMARY payments.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'payments'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `payments` ADD PRIMARY KEY (`payment_id`);
  END IF;

  -- PRIMARY payroll.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'payroll'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `payroll` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY performance.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'performance'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `performance` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY production_consumptions.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_consumptions'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_consumptions` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_consumptions.production_record_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_consumptions'
      AND INDEX_NAME = 'production_record_id'
  ) THEN
    ALTER TABLE `production_consumptions` ADD KEY `production_record_id` (`production_record_id`);
  END IF;

  -- PRIMARY production_correction_archives.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_correction_archives'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_correction_archives` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_correction_archives.production_correction_archives_facility_id_batch_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_correction_archives'
      AND INDEX_NAME = 'production_correction_archives_facility_id_batch_no'
  ) THEN
    ALTER TABLE `production_correction_archives` ADD KEY `production_correction_archives_facility_id_batch_no` (`facility_id`,`batch_no`);
  END IF;

  -- INDEX production_correction_archives.production_correction_archives_archived_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_correction_archives'
      AND INDEX_NAME = 'production_correction_archives_archived_at'
  ) THEN
    ALTER TABLE `production_correction_archives` ADD KEY `production_correction_archives_archived_at` (`archived_at`);
  END IF;

  -- PRIMARY production_costing_records.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_costing_records'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_costing_records` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_costing_records.idx_production_costing_facility_batch_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_costing_records'
      AND INDEX_NAME = 'idx_production_costing_facility_batch_no'
  ) THEN
    ALTER TABLE `production_costing_records` ADD KEY `idx_production_costing_facility_batch_no` (`facility_id`,`batch_no`);
  END IF;

  -- PRIMARY production_manufacturing_records.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_manufacturing_records'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_manufacturing_records` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_manufacturing_records.idx_production_manufacturing_facility_batch_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_manufacturing_records'
      AND INDEX_NAME = 'idx_production_manufacturing_facility_batch_no'
  ) THEN
    ALTER TABLE `production_manufacturing_records` ADD KEY `idx_production_manufacturing_facility_batch_no` (`facility_id`,`batch_no`);
  END IF;

  -- PRIMARY production_orders.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_orders'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_orders` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE production_orders.order_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_orders'
      AND INDEX_NAME = 'order_number'
  ) THEN
    ALTER TABLE `production_orders` ADD UNIQUE KEY `order_number` (`order_number`);
  END IF;

  -- INDEX production_orders.bom_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_orders'
      AND INDEX_NAME = 'bom_id'
  ) THEN
    ALTER TABLE `production_orders` ADD KEY `bom_id` (`bom_id`);
  END IF;

  -- PRIMARY production_records.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_records'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_records` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_records.idx_production_records_facility_batch_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_records'
      AND INDEX_NAME = 'idx_production_records_facility_batch_no'
  ) THEN
    ALTER TABLE `production_records` ADD KEY `idx_production_records_facility_batch_no` (`facility_id`,`batch_no`);
  END IF;

  -- PRIMARY production_record_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_record_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `production_record_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX production_record_items.production_record_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_record_items'
      AND INDEX_NAME = 'production_record_id'
  ) THEN
    ALTER TABLE `production_record_items` ADD KEY `production_record_id` (`production_record_id`);
  END IF;

  -- INDEX production_record_items.product_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_record_items'
      AND INDEX_NAME = 'product_id'
  ) THEN
    ALTER TABLE `production_record_items` ADD KEY `product_id` (`product_id`);
  END IF;

  -- PRIMARY products.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `products` ADD PRIMARY KEY (`id`,`facility_id`,`name`);
  END IF;

  -- UNIQUE products.products_sku_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_sku_facility_id'
  ) THEN
    ALTER TABLE `products` ADD UNIQUE KEY `products_sku_facility_id` (`sku`,`facility_id`);
  END IF;

  -- INDEX products.products_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_facility_id'
  ) THEN
    ALTER TABLE `products` ADD KEY `products_facility_id` (`facility_id`);
  END IF;

  -- INDEX products.products_item_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_item_type'
  ) THEN
    ALTER TABLE `products` ADD KEY `products_item_type` (`item_type`);
  END IF;

  -- INDEX products.products_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_status'
  ) THEN
    ALTER TABLE `products` ADD KEY `products_status` (`status`);
  END IF;

  -- INDEX products.products_supplier_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_supplier_id'
  ) THEN
    ALTER TABLE `products` ADD KEY `products_supplier_id` (`supplier_id`);
  END IF;

  -- INDEX products.products_warehouse_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'products'
      AND INDEX_NAME = 'products_warehouse_id'
  ) THEN
    ALTER TABLE `products` ADD KEY `products_warehouse_id` (`warehouse_id`);
  END IF;

  -- PRIMARY product_groups.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_groups'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `product_groups` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE product_groups.product_groups_name_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_groups'
      AND INDEX_NAME = 'product_groups_name_facility_id'
  ) THEN
    ALTER TABLE `product_groups` ADD UNIQUE KEY `product_groups_name_facility_id` (`name`,`facility_id`);
  END IF;

  -- INDEX product_groups.product_groups_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_groups'
      AND INDEX_NAME = 'product_groups_facility_id'
  ) THEN
    ALTER TABLE `product_groups` ADD KEY `product_groups_facility_id` (`facility_id`);
  END IF;

  -- PRIMARY product_multipliers.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_multipliers'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `product_multipliers` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX product_multipliers.product_multipliers_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_multipliers'
      AND INDEX_NAME = 'product_multipliers_facility_id'
  ) THEN
    ALTER TABLE `product_multipliers` ADD KEY `product_multipliers_facility_id` (`facilityId`);
  END IF;

  -- INDEX product_multipliers.product_multipliers_sku
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_multipliers'
      AND INDEX_NAME = 'product_multipliers_sku'
  ) THEN
    ALTER TABLE `product_multipliers` ADD KEY `product_multipliers_sku` (`sku`);
  END IF;

  -- INDEX product_multipliers.product_multipliers_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_multipliers'
      AND INDEX_NAME = 'product_multipliers_status'
  ) THEN
    ALTER TABLE `product_multipliers` ADD KEY `product_multipliers_status` (`status`);
  END IF;

  -- PRIMARY projects.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `projects` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE projects.project_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'project_number'
  ) THEN
    ALTER TABLE `projects` ADD UNIQUE KEY `project_number` (`project_number`);
  END IF;

  -- UNIQUE projects.projects_project_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_project_number'
  ) THEN
    ALTER TABLE `projects` ADD UNIQUE KEY `projects_project_number` (`project_number`);
  END IF;

  -- INDEX projects.projects_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_facility_id'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_facility_id` (`facilityId`);
  END IF;

  -- INDEX projects.projects_customer_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_customer_number'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_customer_number` (`customer_number`);
  END IF;

  -- INDEX projects.projects_progress_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_progress_status'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_progress_status` (`progress_status`);
  END IF;

  -- INDEX projects.projects_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_status'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_status` (`status`);
  END IF;

  -- INDEX projects.projects_created_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_created_at'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_created_at` (`created_at`);
  END IF;

  -- INDEX projects.projects_follow_up_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'projects'
      AND INDEX_NAME = 'projects_follow_up_status'
  ) THEN
    ALTER TABLE `projects` ADD KEY `projects_follow_up_status` (`follow_up_status`);
  END IF;

  -- PRIMARY promotion_history.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'promotion_history'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `promotion_history` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY public_holidays.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'public_holidays'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `public_holidays` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX public_holidays.idx_public_holidays_facility_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'public_holidays'
      AND INDEX_NAME = 'idx_public_holidays_facility_date'
  ) THEN
    ALTER TABLE `public_holidays` ADD KEY `idx_public_holidays_facility_date` (`facilityId`,`holiday_date`,`status`);
  END IF;

  -- PRIMARY purchase_order.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_order'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `purchase_order` ADD PRIMARY KEY (`id`,`po_id`);
  END IF;

  -- UNIQUE purchase_order.version_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_order'
      AND INDEX_NAME = 'version_id'
  ) THEN
    ALTER TABLE `purchase_order` ADD UNIQUE KEY `version_id` (`version_id`);
  END IF;

  -- PRIMARY purchase_orders.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_orders'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `purchase_orders` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE purchase_orders.po_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_orders'
      AND INDEX_NAME = 'po_number'
  ) THEN
    ALTER TABLE `purchase_orders` ADD UNIQUE KEY `po_number` (`po_number`);
  END IF;

  -- PRIMARY purchase_order_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_order_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `purchase_order_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY purchase_order_list.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_order_list'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `purchase_order_list` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY purchase_requisition.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_requisition'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `purchase_requisition` ADD PRIMARY KEY (`pr_no`);
  END IF;

  -- INDEX purchase_requisition.purchase_requisition_supplier_code_account_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_requisition'
      AND INDEX_NAME = 'purchase_requisition_supplier_code_account_code'
  ) THEN
    ALTER TABLE `purchase_requisition` ADD KEY `purchase_requisition_supplier_code_account_code` (`supplier_code`,`account_code`);
  END IF;

  -- INDEX purchase_requisition.purchase_requisition_memo_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'purchase_requisition'
      AND INDEX_NAME = 'purchase_requisition_memo_id'
  ) THEN
    ALTER TABLE `purchase_requisition` ADD KEY `purchase_requisition_memo_id` (`memo_id`);
  END IF;

  -- PRIMARY pv_collection.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'pv_collection'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `pv_collection` ADD PRIMARY KEY (`pv_code`);
  END IF;

  -- PRIMARY rate_table.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rate_table'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `rate_table` ADD PRIMARY KEY (`rate_id`,`facilityId`);
  END IF;

  -- PRIMARY rebate_rules.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_rules'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `rebate_rules` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX rebate_rules.idx_rebate_rules_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_rules'
      AND INDEX_NAME = 'idx_rebate_rules_facility'
  ) THEN
    ALTER TABLE `rebate_rules` ADD KEY `idx_rebate_rules_facility` (`facility_id`);
  END IF;

  -- INDEX rebate_rules.idx_rebate_rules_period
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_rules'
      AND INDEX_NAME = 'idx_rebate_rules_period'
  ) THEN
    ALTER TABLE `rebate_rules` ADD KEY `idx_rebate_rules_period` (`facility_id`,`from_date`,`to_date`);
  END IF;

  -- PRIMARY rebate_statuses.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_statuses'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `rebate_statuses` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE rebate_statuses.uq_rebate_status_customer_rule
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_statuses'
      AND INDEX_NAME = 'uq_rebate_status_customer_rule'
  ) THEN
    ALTER TABLE `rebate_statuses` ADD UNIQUE KEY `uq_rebate_status_customer_rule` (`facility_id`,`rule_id`,`customer_name`);
  END IF;

  -- INDEX rebate_statuses.idx_rebate_statuses_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_statuses'
      AND INDEX_NAME = 'idx_rebate_statuses_facility'
  ) THEN
    ALTER TABLE `rebate_statuses` ADD KEY `idx_rebate_statuses_facility` (`facility_id`);
  END IF;

  -- INDEX rebate_statuses.idx_rebate_statuses_rule
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_statuses'
      AND INDEX_NAME = 'idx_rebate_statuses_rule'
  ) THEN
    ALTER TABLE `rebate_statuses` ADD KEY `idx_rebate_statuses_rule` (`rule_id`);
  END IF;

  -- PRIMARY record_production.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'record_production'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `record_production` ADD PRIMARY KEY (`production_id`,`facilityId`);
  END IF;

  -- INDEX record_production.customer_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'record_production'
      AND INDEX_NAME = 'customer_id'
  ) THEN
    ALTER TABLE `record_production` ADD KEY `customer_id` (`customer_id`);
  END IF;

  -- PRIMARY requisition_details.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'requisition_details'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `requisition_details` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX requisition_details.requisition_details_pr_no
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'requisition_details'
      AND INDEX_NAME = 'requisition_details_pr_no'
  ) THEN
    ALTER TABLE `requisition_details` ADD KEY `requisition_details_pr_no` (`pr_no`);
  END IF;

  -- INDEX requisition_details.requisition_details_item_code_chart_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'requisition_details'
      AND INDEX_NAME = 'requisition_details_item_code_chart_code'
  ) THEN
    ALTER TABLE `requisition_details` ADD KEY `requisition_details_item_code_chart_code` (`item_code`,`chart_code`);
  END IF;

  -- INDEX requisition_details.requisition_details_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'requisition_details'
      AND INDEX_NAME = 'requisition_details_facility_id'
  ) THEN
    ALTER TABLE `requisition_details` ADD KEY `requisition_details_facility_id` (`facilityId`);
  END IF;

  -- PRIMARY roles.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'roles'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `roles` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE roles.unique_role_name_per_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'roles'
      AND INDEX_NAME = 'unique_role_name_per_facility'
  ) THEN
    ALTER TABLE `roles` ADD UNIQUE KEY `unique_role_name_per_facility` (`name`,`facilityId`);
  END IF;

  -- INDEX roles.idx_roles_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'roles'
      AND INDEX_NAME = 'idx_roles_facility_id'
  ) THEN
    ALTER TABLE `roles` ADD KEY `idx_roles_facility_id` (`facilityId`);
  END IF;

  -- INDEX roles.idx_roles_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'roles'
      AND INDEX_NAME = 'idx_roles_status'
  ) THEN
    ALTER TABLE `roles` ADD KEY `idx_roles_status` (`status`);
  END IF;

  -- INDEX roles.idx_roles_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'roles'
      AND INDEX_NAME = 'idx_roles_name'
  ) THEN
    ALTER TABLE `roles` ADD KEY `idx_roles_name` (`name`);
  END IF;

  -- PRIMARY row_change_logs.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'row_change_logs'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `row_change_logs` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX row_change_logs.idx_rcl_facility_created
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'row_change_logs'
      AND INDEX_NAME = 'idx_rcl_facility_created'
  ) THEN
    ALTER TABLE `row_change_logs` ADD KEY `idx_rcl_facility_created` (`facility_id`,`created_at`);
  END IF;

  -- INDEX row_change_logs.idx_rcl_table_pk
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'row_change_logs'
      AND INDEX_NAME = 'idx_rcl_table_pk'
  ) THEN
    ALTER TABLE `row_change_logs` ADD KEY `idx_rcl_table_pk` (`table_name`,`row_pk`);
  END IF;

  -- INDEX row_change_logs.idx_rcl_facility_table_action
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'row_change_logs'
      AND INDEX_NAME = 'idx_rcl_facility_table_action'
  ) THEN
    ALTER TABLE `row_change_logs` ADD KEY `idx_rcl_facility_table_action` (`facility_id`,`table_name`,`action`);
  END IF;

  -- PRIMARY salary_status_history.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'salary_status_history'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `salary_status_history` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX salary_status_history.employeeId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'salary_status_history'
      AND INDEX_NAME = 'employeeId'
  ) THEN
    ALTER TABLE `salary_status_history` ADD KEY `employeeId` (`employeeId`);
  END IF;

  -- PRIMARY salary_structures.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'salary_structures'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `salary_structures` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE salary_structures.structureCode
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'salary_structures'
      AND INDEX_NAME = 'structureCode'
  ) THEN
    ALTER TABLE `salary_structures` ADD UNIQUE KEY `structureCode` (`structureCode`);
  END IF;

  -- PRIMARY sales.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sales'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `sales` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY sale_fulfillments.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_fulfillments'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `sale_fulfillments` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY sale_fulfillment_lines.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_fulfillment_lines'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `sale_fulfillment_lines` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX sale_fulfillment_lines.fulfillment_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_fulfillment_lines'
      AND INDEX_NAME = 'fulfillment_id'
  ) THEN
    ALTER TABLE `sale_fulfillment_lines` ADD KEY `fulfillment_id` (`fulfillment_id`);
  END IF;

  -- PRIMARY sale_workflows.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_workflows'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `sale_workflows` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE sale_workflows.sale_workflows_facility_id_sale_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_workflows'
      AND INDEX_NAME = 'sale_workflows_facility_id_sale_code'
  ) THEN
    ALTER TABLE `sale_workflows` ADD UNIQUE KEY `sale_workflows_facility_id_sale_code` (`facility_id`,`sale_code`);
  END IF;

  -- INDEX sale_workflows.sale_workflows_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_workflows'
      AND INDEX_NAME = 'sale_workflows_status'
  ) THEN
    ALTER TABLE `sale_workflows` ADD KEY `sale_workflows_status` (`status`);
  END IF;

  -- INDEX sale_workflows.sale_workflows_payment_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_workflows'
      AND INDEX_NAME = 'sale_workflows_payment_type'
  ) THEN
    ALTER TABLE `sale_workflows` ADD KEY `sale_workflows_payment_type` (`payment_type`);
  END IF;

  -- PRIMARY saved_reports.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'saved_reports'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `saved_reports` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX saved_reports.idx_saved_reports_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'saved_reports'
      AND INDEX_NAME = 'idx_saved_reports_facility_id'
  ) THEN
    ALTER TABLE `saved_reports` ADD KEY `idx_saved_reports_facility_id` (`facility_id`);
  END IF;

  -- PRIMARY semi_finished_costing_templates.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_templates'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `semi_finished_costing_templates` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE semi_finished_costing_templates.uniq_semi_finished_costing_facility_prod_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_templates'
      AND INDEX_NAME = 'uniq_semi_finished_costing_facility_prod_name'
  ) THEN
    ALTER TABLE `semi_finished_costing_templates` ADD UNIQUE KEY `uniq_semi_finished_costing_facility_prod_name` (`facility_id`,`product_id`,`template_name`);
  END IF;

  -- INDEX semi_finished_costing_templates.product_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_templates'
      AND INDEX_NAME = 'product_id'
  ) THEN
    ALTER TABLE `semi_finished_costing_templates` ADD KEY `product_id` (`product_id`);
  END IF;

  -- INDEX semi_finished_costing_templates.idx_semi_finished_costing_facility_product
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_templates'
      AND INDEX_NAME = 'idx_semi_finished_costing_facility_product'
  ) THEN
    ALTER TABLE `semi_finished_costing_templates` ADD KEY `idx_semi_finished_costing_facility_product` (`facility_id`,`product_id`);
  END IF;

  -- PRIMARY semi_finished_costing_template_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_template_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `semi_finished_costing_template_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX semi_finished_costing_template_items.template_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_template_items'
      AND INDEX_NAME = 'template_id'
  ) THEN
    ALTER TABLE `semi_finished_costing_template_items` ADD KEY `template_id` (`template_id`);
  END IF;

  -- PRIMARY SequelizeMeta.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'SequelizeMeta'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `SequelizeMeta` ADD PRIMARY KEY (`name`);
  END IF;

  -- UNIQUE SequelizeMeta.name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'SequelizeMeta'
      AND INDEX_NAME = 'name'
  ) THEN
    ALTER TABLE `SequelizeMeta` ADD UNIQUE KEY `name` (`name`);
  END IF;

  -- PRIMARY store_entries.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'store_entries'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `store_entries` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX store_entries.product_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'store_entries'
      AND INDEX_NAME = 'product_id'
  ) THEN
    ALTER TABLE `store_entries` ADD KEY `product_id` (`product_id`);
  END IF;

  -- INDEX store_entries.multiplier_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'store_entries'
      AND INDEX_NAME = 'multiplier_id'
  ) THEN
    ALTER TABLE `store_entries` ADD KEY `multiplier_id` (`multiplier_id`);
  END IF;

  -- INDEX store_entries.idx_store_entries_branchId
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'store_entries'
      AND INDEX_NAME = 'idx_store_entries_branchId'
  ) THEN
    ALTER TABLE `store_entries` ADD KEY `idx_store_entries_branchId` (`branchId`);
  END IF;

  -- PRIMARY suppliersinfo.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD PRIMARY KEY (`facilityId`,`supplier_number`);
  END IF;

  -- UNIQUE suppliersinfo.suppliersinfo_facility_id_supplier_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'suppliersinfo_facility_id_supplier_number'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD UNIQUE KEY `suppliersinfo_facility_id_supplier_number` (`facilityId`,`supplier_number`);
  END IF;

  -- INDEX suppliersinfo.idx_suppliersinfo_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'idx_suppliersinfo_facility_id'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `idx_suppliersinfo_facility_id` (`facilityId`);
  END IF;

  -- INDEX suppliersinfo.idx_suppliersinfo_supplier_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'idx_suppliersinfo_supplier_name'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `idx_suppliersinfo_supplier_name` (`supplier_name`);
  END IF;

  -- INDEX suppliersinfo.idx_suppliersinfo_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'idx_suppliersinfo_status'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `idx_suppliersinfo_status` (`status`);
  END IF;

  -- INDEX suppliersinfo.idx_suppliersinfo_email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'idx_suppliersinfo_email'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `idx_suppliersinfo_email` (`email`);
  END IF;

  -- INDEX suppliersinfo.suppliersinfo_supplier_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'suppliersinfo_supplier_name'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `suppliersinfo_supplier_name` (`supplier_name`);
  END IF;

  -- INDEX suppliersinfo.suppliersinfo_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'suppliersinfo_status'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `suppliersinfo_status` (`status`);
  END IF;

  -- INDEX suppliersinfo.suppliersinfo_email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'suppliersinfo_email'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `suppliersinfo_email` (`email`);
  END IF;

  -- INDEX suppliersinfo.idx_suppliersinfo_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'suppliersinfo'
      AND INDEX_NAME = 'idx_suppliersinfo_branch_id'
  ) THEN
    ALTER TABLE `suppliersinfo` ADD KEY `idx_suppliersinfo_branch_id` (`branch_id`);
  END IF;

  -- PRIMARY supplier_account_information.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX supplier_account_information.idx_supplier_account_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND INDEX_NAME = 'idx_supplier_account_facility_id'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD KEY `idx_supplier_account_facility_id` (`facilityId`);
  END IF;

  -- INDEX supplier_account_information.idx_supplier_account_supplier_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND INDEX_NAME = 'idx_supplier_account_supplier_number'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD KEY `idx_supplier_account_supplier_number` (`supplier_number`);
  END IF;

  -- INDEX supplier_account_information.idx_supplier_account_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND INDEX_NAME = 'idx_supplier_account_number'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD KEY `idx_supplier_account_number` (`account_number`);
  END IF;

  -- INDEX supplier_account_information.idx_supplier_account_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND INDEX_NAME = 'idx_supplier_account_status'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD KEY `idx_supplier_account_status` (`status`);
  END IF;

  -- INDEX supplier_account_information.idx_supplier_account_bank_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_account_information'
      AND INDEX_NAME = 'idx_supplier_account_bank_name'
  ) THEN
    ALTER TABLE `supplier_account_information` ADD KEY `idx_supplier_account_bank_name` (`bank_name`);
  END IF;

  -- PRIMARY supplier_addresses.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_addresses'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `supplier_addresses` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX supplier_addresses.supplier_addresses_facility_id_supplier_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_addresses'
      AND INDEX_NAME = 'supplier_addresses_facility_id_supplier_number'
  ) THEN
    ALTER TABLE `supplier_addresses` ADD KEY `supplier_addresses_facility_id_supplier_number` (`facility_id`,`supplier_number`);
  END IF;

  -- INDEX supplier_addresses.supplier_addresses_address_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_addresses'
      AND INDEX_NAME = 'supplier_addresses_address_type'
  ) THEN
    ALTER TABLE `supplier_addresses` ADD KEY `supplier_addresses_address_type` (`address_type`);
  END IF;

  -- PRIMARY supplier_contact.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_contact'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `supplier_contact` ADD PRIMARY KEY (`head`,`subhead`);
  END IF;

  -- PRIMARY supplier_contacts.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_contacts'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `supplier_contacts` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX supplier_contacts.supplier_contacts_facility_id_supplier_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_contacts'
      AND INDEX_NAME = 'supplier_contacts_facility_id_supplier_number'
  ) THEN
    ALTER TABLE `supplier_contacts` ADD KEY `supplier_contacts_facility_id_supplier_number` (`facility_id`,`supplier_number`);
  END IF;

  -- INDEX supplier_contacts.supplier_contacts_is_primary
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_contacts'
      AND INDEX_NAME = 'supplier_contacts_is_primary'
  ) THEN
    ALTER TABLE `supplier_contacts` ADD KEY `supplier_contacts_is_primary` (`is_primary`);
  END IF;

  -- PRIMARY supplier_entries.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'supplier_entries'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `supplier_entries` ADD PRIMARY KEY (`entry_id`);
  END IF;

  -- PRIMARY taxes.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `taxes` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE taxes.taxes_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND INDEX_NAME = 'taxes_id'
  ) THEN
    ALTER TABLE `taxes` ADD UNIQUE KEY `taxes_id` (`id`);
  END IF;

  -- INDEX taxes.taxes_head
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND INDEX_NAME = 'taxes_head'
  ) THEN
    ALTER TABLE `taxes` ADD KEY `taxes_head` (`head`);
  END IF;

  -- INDEX taxes.taxes_account_sub_head
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND INDEX_NAME = 'taxes_account_sub_head'
  ) THEN
    ALTER TABLE `taxes` ADD KEY `taxes_account_sub_head` (`account_sub_head`);
  END IF;

  -- INDEX taxes.taxes_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND INDEX_NAME = 'taxes_facility_id'
  ) THEN
    ALTER TABLE `taxes` ADD KEY `taxes_facility_id` (`facilityId`);
  END IF;

  -- INDEX taxes.taxes_taxes_created_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'taxes'
      AND INDEX_NAME = 'taxes_taxes_created_by'
  ) THEN
    ALTER TABLE `taxes` ADD KEY `taxes_taxes_created_by` (`taxes_created_by`);
  END IF;

  -- PRIMARY Teams.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'Teams'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `Teams` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY team_table.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'team_table'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `team_table` ADD PRIMARY KEY (`team_number`);
  END IF;

  -- INDEX team_table.team_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'team_table'
      AND INDEX_NAME = 'team_id'
  ) THEN
    ALTER TABLE `team_table` ADD KEY `team_id` (`team_id`);
  END IF;

  -- PRIMARY transactions.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'transactions'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `transactions` ADD PRIMARY KEY (`transaction_id`);
  END IF;

  -- UNIQUE transactions.version_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'transactions'
      AND INDEX_NAME = 'version_id'
  ) THEN
    ALTER TABLE `transactions` ADD UNIQUE KEY `version_id` (`version_id`);
  END IF;

  -- PRIMARY transactions_data.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'transactions_data'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `transactions_data` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY transaction_data_items.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'transaction_data_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `transaction_data_items` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX transaction_data_items.transaction_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'transaction_data_items'
      AND INDEX_NAME = 'transaction_id'
  ) THEN
    ALTER TABLE `transaction_data_items` ADD KEY `transaction_id` (`transaction_id`);
  END IF;

  -- PRIMARY unit_of_measurement.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'unit_of_measurement'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `unit_of_measurement` ADD PRIMARY KEY (`id`);
  END IF;

  -- PRIMARY users.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'users'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `users` ADD PRIMARY KEY (`id`,`facilityId`);
  END IF;

  -- UNIQUE users.email
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'email'
  ) THEN
    ALTER TABLE `users` ADD UNIQUE KEY `email` (`email`);
  END IF;

  -- INDEX users.id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'id'
  ) THEN
    ALTER TABLE `users` ADD KEY `id` (`id`,`facilityId`);
  END IF;

  -- PRIMARY user_branches.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `user_branches` ADD PRIMARY KEY (`id`);
  END IF;

  -- UNIQUE user_branches.uniq_user_branch
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND INDEX_NAME = 'uniq_user_branch'
  ) THEN
    ALTER TABLE `user_branches` ADD UNIQUE KEY `uniq_user_branch` (`user_id`,`branch_id`);
  END IF;

  -- UNIQUE user_branches.user_branches_user_id_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND INDEX_NAME = 'user_branches_user_id_branch_id'
  ) THEN
    ALTER TABLE `user_branches` ADD UNIQUE KEY `user_branches_user_id_branch_id` (`user_id`,`branch_id`);
  END IF;

  -- INDEX user_branches.idx_ub_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND INDEX_NAME = 'idx_ub_user_id'
  ) THEN
    ALTER TABLE `user_branches` ADD KEY `idx_ub_user_id` (`user_id`);
  END IF;

  -- INDEX user_branches.idx_ub_branch_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND INDEX_NAME = 'idx_ub_branch_id'
  ) THEN
    ALTER TABLE `user_branches` ADD KEY `idx_ub_branch_id` (`branch_id`);
  END IF;

  -- INDEX user_branches.idx_ub_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'user_branches'
      AND INDEX_NAME = 'idx_ub_facility_id'
  ) THEN
    ALTER TABLE `user_branches` ADD KEY `idx_ub_facility_id` (`facility_id`);
  END IF;

  -- PRIMARY warehouses.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'warehouses'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `warehouses` ADD PRIMARY KEY (`id`);
  END IF;

  -- INDEX warehouses.warehouses_facility_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'warehouses'
      AND INDEX_NAME = 'warehouses_facility_id'
  ) THEN
    ALTER TABLE `warehouses` ADD KEY `warehouses_facility_id` (`facility_id`);
  END IF;

  -- INDEX warehouses.warehouses_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'warehouses'
      AND INDEX_NAME = 'warehouses_status'
  ) THEN
    ALTER TABLE `warehouses` ADD KEY `warehouses_status` (`status`);
  END IF;

  -- PRIMARY wip_action_history.PRIMARY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'wip_action_history'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE `wip_action_history` ADD PRIMARY KEY (`id`);
  END IF;

  -- CONSTRAINT account.account_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'account'
      AND CONSTRAINT_NAME = 'account_ibfk_1'
  ) THEN
    ALTER TABLE `account` ADD CONSTRAINT `account_ibfk_1` FOREIGN KEY (`facilityId`) REFERENCES `business` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT assets.assets_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND CONSTRAINT_NAME = 'assets_ibfk_1'
  ) THEN
    ALTER TABLE `assets` ADD CONSTRAINT `assets_ibfk_1` FOREIGN KEY (`custodianId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT assets.assets_ibfk_2
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND CONSTRAINT_NAME = 'assets_ibfk_2'
  ) THEN
    ALTER TABLE `assets` ADD CONSTRAINT `assets_ibfk_2` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT assets.assets_ibfk_3
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'assets'
      AND CONSTRAINT_NAME = 'assets_ibfk_3'
  ) THEN
    ALTER TABLE `assets` ADD CONSTRAINT `assets_ibfk_3` FOREIGN KEY (`updatedBy`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT discount_table.fk_discount_account_head
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND CONSTRAINT_NAME = 'fk_discount_account_head'
  ) THEN
    ALTER TABLE `discount_table` ADD CONSTRAINT `fk_discount_account_head` FOREIGN KEY (`discount_account_head`,`facilityId`) REFERENCES `account_category` (`code`, `facility_id`) ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT discount_table.fk_discount_facility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'discount_table'
      AND CONSTRAINT_NAME = 'fk_discount_facility'
  ) THEN
    ALTER TABLE `discount_table` ADD CONSTRAINT `fk_discount_facility` FOREIGN KEY (`facilityId`) REFERENCES `business` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT goods_transfer_items.goods_transfer_items_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'goods_transfer_items'
      AND CONSTRAINT_NAME = 'goods_transfer_items_ibfk_1'
  ) THEN
    ALTER TABLE `goods_transfer_items` ADD CONSTRAINT `goods_transfer_items_ibfk_1` FOREIGN KEY (`transfer_id`) REFERENCES `goods_transfers` (`id`) ON DELETE CASCADE;
  END IF;

  -- CONSTRAINT kyc_business_documents.kyc_business_documents_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_documents'
      AND CONSTRAINT_NAME = 'kyc_business_documents_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_business_documents` ADD CONSTRAINT `kyc_business_documents_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT kyc_business_information.kyc_business_information_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_business_information'
      AND CONSTRAINT_NAME = 'kyc_business_information_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_business_information` ADD CONSTRAINT `kyc_business_information_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT kyc_contact_information.kyc_contact_information_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_contact_information'
      AND CONSTRAINT_NAME = 'kyc_contact_information_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_contact_information` ADD CONSTRAINT `kyc_contact_information_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT kyc_service_settings.kyc_service_settings_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_service_settings'
      AND CONSTRAINT_NAME = 'kyc_service_settings_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_service_settings` ADD CONSTRAINT `kyc_service_settings_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT kyc_stakeholders.kyc_stakeholders_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_stakeholders'
      AND CONSTRAINT_NAME = 'kyc_stakeholders_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_stakeholders` ADD CONSTRAINT `kyc_stakeholders_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT kyc_terms_acceptance.kyc_terms_acceptance_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'kyc_terms_acceptance'
      AND CONSTRAINT_NAME = 'kyc_terms_acceptance_ibfk_1'
  ) THEN
    ALTER TABLE `kyc_terms_acceptance` ADD CONSTRAINT `kyc_terms_acceptance_ibfk_1` FOREIGN KEY (`kyc_user_id`) REFERENCES `kyc_users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT loans.loans_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'loans'
      AND CONSTRAINT_NAME = 'loans_ibfk_1'
  ) THEN
    ALTER TABLE `loans` ADD CONSTRAINT `loans_ibfk_1` FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT mixture_ingredients.mixture_ingredients_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'mixture_ingredients'
      AND CONSTRAINT_NAME = 'mixture_ingredients_ibfk_1'
  ) THEN
    ALTER TABLE `mixture_ingredients` ADD CONSTRAINT `mixture_ingredients_ibfk_1` FOREIGN KEY (`mixture_id`) REFERENCES `mixtures` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT production_consumptions.production_consumptions_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'production_consumptions'
      AND CONSTRAINT_NAME = 'production_consumptions_ibfk_1'
  ) THEN
    ALTER TABLE `production_consumptions` ADD CONSTRAINT `production_consumptions_ibfk_1` FOREIGN KEY (`production_record_id`) REFERENCES `production_records` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT product_groups.product_groups_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'product_groups'
      AND CONSTRAINT_NAME = 'product_groups_ibfk_1'
  ) THEN
    ALTER TABLE `product_groups` ADD CONSTRAINT `product_groups_ibfk_1` FOREIGN KEY (`facility_id`) REFERENCES `business` (`id`);
  END IF;

  -- CONSTRAINT rebate_statuses.rebate_statuses_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'rebate_statuses'
      AND CONSTRAINT_NAME = 'rebate_statuses_ibfk_1'
  ) THEN
    ALTER TABLE `rebate_statuses` ADD CONSTRAINT `rebate_statuses_ibfk_1` FOREIGN KEY (`rule_id`) REFERENCES `rebate_rules` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT salary_status_history.salary_status_history_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'salary_status_history'
      AND CONSTRAINT_NAME = 'salary_status_history_ibfk_1'
  ) THEN
    ALTER TABLE `salary_status_history` ADD CONSTRAINT `salary_status_history_ibfk_1` FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT sale_fulfillment_lines.sale_fulfillment_lines_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'sale_fulfillment_lines'
      AND CONSTRAINT_NAME = 'sale_fulfillment_lines_ibfk_1'
  ) THEN
    ALTER TABLE `sale_fulfillment_lines` ADD CONSTRAINT `sale_fulfillment_lines_ibfk_1` FOREIGN KEY (`fulfillment_id`) REFERENCES `sale_fulfillments` (`id`) ON DELETE CASCADE;
  END IF;

  -- CONSTRAINT semi_finished_costing_templates.semi_finished_costing_templates_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_templates'
      AND CONSTRAINT_NAME = 'semi_finished_costing_templates_ibfk_1'
  ) THEN
    ALTER TABLE `semi_finished_costing_templates` ADD CONSTRAINT `semi_finished_costing_templates_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- CONSTRAINT semi_finished_costing_template_items.semi_finished_costing_template_items_ibfk_1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = dbname AND TABLE_NAME = 'semi_finished_costing_template_items'
      AND CONSTRAINT_NAME = 'semi_finished_costing_template_items_ibfk_1'
  ) THEN
    ALTER TABLE `semi_finished_costing_template_items` ADD CONSTRAINT `semi_finished_costing_template_items_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `semi_finished_costing_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

END $$

DELIMITER ;

CALL ensure_aa_erp_indexes();
DROP PROCEDURE IF EXISTS ensure_aa_erp_indexes;

SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

SELECT IFNULL(@aa_erp_index_errors, 0) AS skipped_or_failed_alters;
