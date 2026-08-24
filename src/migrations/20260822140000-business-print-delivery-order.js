"use strict";

/**
 * Toggle whether Sales Invoice preview/print includes the Delivery Order section.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.print_delivery_order) {
      await queryInterface.addColumn("business", "print_delivery_order", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "When true, invoice preview/print includes the Delivery Order section",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.print_delivery_order) {
      await queryInterface.removeColumn("business", "print_delivery_order");
    }
  },
};
