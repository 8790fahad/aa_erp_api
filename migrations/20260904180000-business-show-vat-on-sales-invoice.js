"use strict";

/**
 * Toggle whether Sales Invoice preview/print shows VAT lines.
 * When off: exclusive VAT is folded into unit price; inclusive VAT line is hidden.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.show_vat_on_sales_invoice) {
      await queryInterface.addColumn("business", "show_vat_on_sales_invoice", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "When true, sales invoice shows VAT. When false, exclusive VAT is in unit price and VAT lines are hidden.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.show_vat_on_sales_invoice) {
      await queryInterface.removeColumn("business", "show_vat_on_sales_invoice");
    }
  },
};
