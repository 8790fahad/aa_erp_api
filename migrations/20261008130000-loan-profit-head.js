"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const setups = await queryInterface.describeTable("loan_setups");
    if (!setups.profitHead) {
      await queryInterface.addColumn("loan_setups", "profitHead", {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }
    const repayments = await queryInterface.describeTable("loan_repayments");
    if (!repayments.profit) {
      await queryInterface.addColumn("loan_repayments", "profit", {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const setups = await queryInterface.describeTable("loan_setups");
    if (setups.profitHead) {
      await queryInterface.removeColumn("loan_setups", "profitHead");
    }
    const repayments = await queryInterface.describeTable("loan_repayments");
    if (repayments.profit) {
      await queryInterface.removeColumn("loan_repayments", "profit");
    }
  },
};
