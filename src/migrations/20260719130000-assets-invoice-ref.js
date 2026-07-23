"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("assets");
    if (!table.invoice_ref) {
      await queryInterface.addColumn("assets", "invoice_ref", {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: "Linked purchase bill / invoice reference",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("assets");
    if (table.invoice_ref) {
      await queryInterface.removeColumn("assets", "invoice_ref");
    }
  },
};
