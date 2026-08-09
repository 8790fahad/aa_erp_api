"use strict";

/** Widen general_ledger.reference_number so invoice/payment refs are not truncated. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("general_ledger", "reference_number", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("general_ledger", "reference_number", {
      type: Sequelize.STRING(15),
      allowNull: true,
    });
  },
};
