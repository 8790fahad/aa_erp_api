"use strict";

/**
 * Sales invoice print: color vs black and white (default black and white).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.sales_invoice_print_in_color) {
      await queryInterface.addColumn("business", "sales_invoice_print_in_color", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, sales invoices print in color. When false (default), they print black and white.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.sales_invoice_print_in_color) {
      await queryInterface.removeColumn(
        "business",
        "sales_invoice_print_in_color",
      );
    }
  },
};
