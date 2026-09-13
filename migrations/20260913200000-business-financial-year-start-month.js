"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.financial_year_start_month) {
      await queryInterface.addColumn("business", "financial_year_start_month", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment:
          "Month the financial year starts (1=January … 12=December). Default calendar year.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.financial_year_start_month) {
      await queryInterface.removeColumn("business", "financial_year_start_month");
    }
  },
};
