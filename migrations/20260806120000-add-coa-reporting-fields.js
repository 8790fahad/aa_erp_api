"use strict";

/**
 * Management-report metadata on account_category:
 * normal_balance, fs_section, reporting_behavior, alternate_nature,
 * account_role, pl_line — support P&L mapping and VAT-style balance-switch.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'account_category'",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const addIfMissing = async (column, definition) => {
      const [columns] = await queryInterface.sequelize.query(
        `SHOW COLUMNS FROM \`account_category\` LIKE '${column}'`,
      );
      if (Array.isArray(columns) && columns.length > 0) {
        return;
      }
      await queryInterface.addColumn("account_category", column, definition);
    };

    await addIfMissing("normal_balance", {
      type: Sequelize.STRING(10),
      allowNull: true,
      comment: "debit | credit",
    });
    await addIfMissing("fs_section", {
      type: Sequelize.STRING(30),
      allowNull: true,
      comment: "balance_sheet | profit_and_loss | off_statement (also BS/PL)",
    });
    await addIfMissing("reporting_behavior", {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: "fixed",
      comment: "fixed | balance_switch",
    });
    await addIfMissing("alternate_nature", {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: "Nature when balance contradicts primary (e.g. ASSET for VAT)",
    });
    await addIfMissing("account_role", {
      type: Sequelize.STRING(40),
      allowNull: true,
      defaultValue: "general",
      comment: "tax_control | bank | ar | ap | clearing | retained_earnings | general",
    });
    await addIfMissing("pl_line", {
      type: Sequelize.STRING(40),
      allowNull: true,
      comment:
        "turnover | cost_of_sales | admin_costs | other_income | finance | tax | impairment | interest",
    });
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'account_category'",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const removeIfPresent = async (column) => {
      const [columns] = await queryInterface.sequelize.query(
        `SHOW COLUMNS FROM \`account_category\` LIKE '${column}'`,
      );
      if (!Array.isArray(columns) || columns.length === 0) {
        return;
      }
      await queryInterface.removeColumn("account_category", column);
    };

    for (const col of [
      "pl_line",
      "account_role",
      "alternate_nature",
      "reporting_behavior",
      "fs_section",
      "normal_balance",
    ]) {
      await removeIfPresent(col);
    }
  },
};
