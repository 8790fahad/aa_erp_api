"use strict";

/**
 * Delivery Order print format: match (with invoice A4/A5) or thermal (80mm).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.delivery_order_format) {
      await queryInterface.addColumn("business", "delivery_order_format", {
        type: Sequelize.ENUM("match", "thermal"),
        allowNull: false,
        defaultValue: "match",
        comment:
          "Delivery Order layout: match invoice paper, or thermal 80mm",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.delivery_order_format) {
      await queryInterface.removeColumn("business", "delivery_order_format");
    }
  },
};
