"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.paye_auto_calculation) {
      await queryInterface.addColumn("business", "paye_auto_calculation", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "When true, PAYE is computed automatically from pay components and tax settings",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.paye_auto_calculation) {
      await queryInterface.removeColumn("business", "paye_auto_calculation");
    }
  },
};
