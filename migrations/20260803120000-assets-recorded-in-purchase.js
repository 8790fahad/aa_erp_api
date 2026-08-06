"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("assets");
    if (!table.recorded_in_purchase) {
      await queryInterface.addColumn("assets", "recorded_in_purchase", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "Asset cost already booked via purchase — skip capitalization and depreciation GL",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("assets");
    if (table.recorded_in_purchase) {
      await queryInterface.removeColumn("assets", "recorded_in_purchase");
    }
  },
};
