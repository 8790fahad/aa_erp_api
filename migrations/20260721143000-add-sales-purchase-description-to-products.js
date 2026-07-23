"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("products");
    if (!table.sales_description) {
      await queryInterface.addColumn("products", "sales_description", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!table.purchase_description) {
      await queryInterface.addColumn("products", "purchase_description", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("products");
    if (table.sales_description) {
      await queryInterface.removeColumn("products", "sales_description");
    }
    if (table.purchase_description) {
      await queryInterface.removeColumn("products", "purchase_description");
    }
  },
};
