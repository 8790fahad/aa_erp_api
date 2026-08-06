"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("rebate_statuses");
    if (!table.credit_note_number) {
      await queryInterface.addColumn("rebate_statuses", "credit_note_number", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "payout_type",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("rebate_statuses");
    if (table.credit_note_number) {
      await queryInterface.removeColumn("rebate_statuses", "credit_note_number");
    }
  },
};
