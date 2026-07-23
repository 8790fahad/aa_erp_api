"use strict";

/**
 * Converts manual SQL updates from db_updates.sql into a reversible migration.
 * - up: creates loans / loan_repayments / salary_status_history / impress + adds columns
 * - down: removes added columns and drops created tables
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log("Skipping HR/impress schema migration — MySQL/MariaDB only");
      return;
    }

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`loans\` (
        \`id\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`employeeId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`facilityId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`amount\` DECIMAL(10,2) NOT NULL,
        \`purpose\` VARCHAR(255) NOT NULL,
        \`repaymentMethod\` ENUM('Self', 'Salary Deduction') DEFAULT 'Salary Deduction',
        \`status\` ENUM('Pending', 'Approved', 'Repaying', 'Paid Off', 'Rejected') DEFAULT 'Pending',
        \`monthlyDeductionAmount\` DECIMAL(10,2) DEFAULT NULL,
        \`durationMonths\` INT NOT NULL,
        \`amountPaid\` DECIMAL(10,2) DEFAULT 0.00,
        \`startDate\` DATETIME DEFAULT NULL,
        \`createdBy\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`updatedBy\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`loans\`
      ADD COLUMN IF NOT EXISTS \`loanSetupId\` CHAR(36) BINARY AFTER \`employeeId\`,
      ADD COLUMN IF NOT EXISTS \`receivableHead\` VARCHAR(100) AFTER \`updatedBy\`;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`salary_structures\`
      ADD COLUMN IF NOT EXISTS \`paymentType\`
      ENUM('Monthly', 'Hourly', 'Daily') NOT NULL DEFAULT 'Monthly';
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`salary_structures\`
      ADD COLUMN IF NOT EXISTS \`accountCode\` VARCHAR(100) NOT NULL AFTER \`paymentType\`;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`salary_structures\`
      MODIFY COLUMN \`payeRate\` DECIMAL(20,2) NULL DEFAULT '0.00' COMMENT 'PAYE tax rate percentage';
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`loan_repayments\` (
        \`id\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`loanId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`facilityId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`amount\` DECIMAL(10,2) NOT NULL,
        \`paymentDate\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`paymentMethod\` ENUM('Manual', 'Payroll Deduction') NOT NULL,
        \`reference\` VARCHAR(255) DEFAULT NULL,
        \`createdBy\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL,
        FOREIGN KEY (\`loanId\`) REFERENCES \`loans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`payroll\`
      ADD COLUMN IF NOT EXISTS \`allowance_details\` JSON DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS \`deduction_details\` JSON DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS \`bonus_details\` JSON DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS \`bonuses\` DECIMAL(15,2) NOT NULL DEFAULT 0.00;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`allowances\`
      ADD COLUMN IF NOT EXISTS \`employeeId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS \`accountCode\` VARCHAR(100) NOT NULL AFTER \`employeeId\`;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`bonuses\`
      ADD COLUMN IF NOT EXISTS \`accountCode\` VARCHAR(100) NOT NULL AFTER \`updatedAt\`;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`payroll\`
      ADD COLUMN IF NOT EXISTS \`paymentType\` ENUM('Monthly', 'Daily', 'Hourly') NOT NULL DEFAULT 'Monthly',
      ADD COLUMN IF NOT EXISTS \`paymentNote\` VARCHAR(255) DEFAULT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`employees\`
      ADD COLUMN IF NOT EXISTS \`salaryStatus\` ENUM('Active', 'Stopped') NOT NULL DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS \`salaryStatusReason\` TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS \`salaryStatusDate\` DATETIME DEFAULT NULL;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`salary_status_history\` (
        \`id\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`employeeId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`facilityId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`status\` ENUM('Active', 'Stopped') NOT NULL,
        \`reason\` TEXT NOT NULL,
        \`date\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`performedBy\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`createdAt\` DATETIME NOT NULL,
        \`updatedAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE \`bank_accounts\`
      ADD COLUMN IF NOT EXISTS \`payroll_template\` LONGTEXT DEFAULT NULL;
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`impress\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`facility_id\` VARCHAR(50) NOT NULL,
        \`ref_number\` VARCHAR(50) NOT NULL,
        \`reference_display\` VARCHAR(80) DEFAULT NULL,
        \`user_id\` VARCHAR(100) DEFAULT NULL,
        \`transaction_date\` DATE NOT NULL,
        \`remark\` TEXT,
        \`mode_of_payment\` VARCHAR(20) NOT NULL,
        \`cheque_number\` VARCHAR(50) DEFAULT NULL,
        \`total_expense\` DECIMAL(20, 2) NOT NULL,
        \`total_vat\` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
        \`total_payment\` DECIMAL(20, 2) NOT NULL,
        \`line_count\` INT NOT NULL DEFAULT 1,
        \`lines_json\` JSON DEFAULT NULL,
        \`payment_meta_json\` JSON DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_impress_facility_ref\` (\`facility_id\`, \`ref_number\`),
        KEY \`idx_impress_facility_date\` (\`facility_id\`, \`transaction_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    // Drop dependent tables first
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS `loan_repayments`;");
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS `salary_status_history`;");

    // Remove added columns
    await queryInterface.sequelize.query(`
      ALTER TABLE \`salary_structures\`
      DROP COLUMN IF EXISTS \`paymentType\`,
      DROP COLUMN IF EXISTS \`accountCode\`;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`salary_structures\`
      MODIFY COLUMN \`payeRate\` DECIMAL(20,2) NULL DEFAULT '0.00' COMMENT 'PAYE: fixed amount or percentage-scale value (payroll calculation)';
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`payroll\`
      DROP COLUMN IF EXISTS \`allowance_details\`,
      DROP COLUMN IF EXISTS \`deduction_details\`,
      DROP COLUMN IF EXISTS \`bonus_details\`,
      DROP COLUMN IF EXISTS \`bonuses\`,
      DROP COLUMN IF EXISTS \`paymentType\`,
      DROP COLUMN IF EXISTS \`paymentNote\`;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`allowances\`
      DROP COLUMN IF EXISTS \`employeeId\`,
      DROP COLUMN IF EXISTS \`accountCode\`;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`bonuses\`
      DROP COLUMN IF EXISTS \`accountCode\`;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`employees\`
      DROP COLUMN IF EXISTS \`salaryStatus\`,
      DROP COLUMN IF EXISTS \`salaryStatusReason\`,
      DROP COLUMN IF EXISTS \`salaryStatusDate\`;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE \`bank_accounts\`
      DROP COLUMN IF EXISTS \`payroll_template\`;
    `);

    // Drop tables created by this migration
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS `loans`;");
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS `impress`;");
  },
};
