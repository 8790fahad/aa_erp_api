"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("allowances");
    if (!table.isTaxable) {
      await queryInterface.addColumn("allowances", "isTaxable", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether allowance amount is included in taxable gross pay",
      });
      await queryInterface.sequelize.query(
        "UPDATE allowances SET isTaxable = 0 WHERE type = 'deduction'",
      );
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("allowances");
    if (table.isTaxable) {
      await queryInterface.removeColumn("allowances", "isTaxable");
    }
  },
};
