"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("products");

    if (!table.daily_sales_limit) {
      await queryInterface.addColumn("products", "daily_sales_limit", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Max units sellable per day; null = unlimited",
      });
    }
    if (!table.weekly_sales_limit) {
      await queryInterface.addColumn("products", "weekly_sales_limit", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Max units sellable per ISO week; null = unlimited",
      });
    }
    if (!table.monthly_sales_limit) {
      await queryInterface.addColumn("products", "monthly_sales_limit", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Max units sellable per calendar month; null = unlimited",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("products");
    if (table.monthly_sales_limit) {
      await queryInterface.removeColumn("products", "monthly_sales_limit");
    }
    if (table.weekly_sales_limit) {
      await queryInterface.removeColumn("products", "weekly_sales_limit");
    }
    if (table.daily_sales_limit) {
      await queryInterface.removeColumn("products", "daily_sales_limit");
    }
  },
};
