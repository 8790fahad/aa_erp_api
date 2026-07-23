"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.depreciation_method) {
      await queryInterface.addColumn("business", "depreciation_method", {
        type: Sequelize.ENUM("Straight Line", "Reducing Balance"),
        allowNull: false,
        defaultValue: "Straight Line",
        comment: "Default fixed-asset depreciation method for new assets",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.depreciation_method) {
      await queryInterface.removeColumn("business", "depreciation_method");
    }
  },
};
