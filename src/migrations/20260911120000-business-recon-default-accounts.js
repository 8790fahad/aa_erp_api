"use strict";

/** Default Collection Reconciliation heads: till cash, Safe, shortage. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (!table.recon_cash_account_code) {
      await queryInterface.addColumn("business", "recon_cash_account_code", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        comment: "Default till / cash-on-hand head for Collection Reconciliation",
      });
    }
    if (!table.recon_safe_account_code) {
      await queryInterface.addColumn("business", "recon_safe_account_code", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        comment: "Default Safe head for Collection Reconciliation",
      });
    }
    if (!table.recon_shortage_account_code) {
      await queryInterface.addColumn("business", "recon_shortage_account_code", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        comment: "Default shortage head for Collection Reconciliation",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (table.recon_shortage_account_code) {
      await queryInterface.removeColumn("business", "recon_shortage_account_code");
    }
    if (table.recon_safe_account_code) {
      await queryInterface.removeColumn("business", "recon_safe_account_code");
    }
    if (table.recon_cash_account_code) {
      await queryInterface.removeColumn("business", "recon_cash_account_code");
    }
  },
};
