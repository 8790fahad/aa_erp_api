"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("products");

    if (!table.sales_stopped) {
      await queryInterface.addColumn("products", "sales_stopped", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "When true, product cannot be sold on sales invoices",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("products");
    if (table.sales_stopped) {
      await queryInterface.removeColumn("products", "sales_stopped");
    }
  },
};
