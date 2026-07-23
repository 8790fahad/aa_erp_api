"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("paye_settings");
    if (!table.payeLedgerAccount) {
      await queryInterface.addColumn("paye_settings", "payeLedgerAccount", {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Chart of account head for PAYE tax payable liability",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("paye_settings");
    if (table.payeLedgerAccount) {
      await queryInterface.removeColumn("paye_settings", "payeLedgerAccount");
    }
  },
};
