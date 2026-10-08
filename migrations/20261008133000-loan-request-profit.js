"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const loans = await queryInterface.describeTable("loans");
    if (!loans.profit) {
      await queryInterface.addColumn("loans", "profit", {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const loans = await queryInterface.describeTable("loans");
    if (loans.profit) {
      await queryInterface.removeColumn("loans", "profit");
    }
  },
};
