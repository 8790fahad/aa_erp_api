"use strict";

/** Opening investment balance for a business associate. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("employees");
    if (!table.investmentOpeningBalance) {
      await queryInterface.addColumn("employees", "investmentOpeningBalance", {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!table.investmentOpeningDate) {
      await queryInterface.addColumn("employees", "investmentOpeningDate", {
        type: Sequelize.DATEONLY,
        allowNull: true,
      });
    }
    if (!table.investmentAccountHead) {
      await queryInterface.addColumn("employees", "investmentAccountHead", {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }
    if (!table.investmentReference) {
      await queryInterface.addColumn("employees", "investmentReference", {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("employees");
    for (const column of [
      "investmentReference",
      "investmentAccountHead",
      "investmentOpeningDate",
      "investmentOpeningBalance",
    ]) {
      if (table[column]) {
        await queryInterface.removeColumn("employees", column);
      }
    }
  },
};
