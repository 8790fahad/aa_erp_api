"use strict";

/**
 * Allow or block changing the selling price on a sales invoice.
 * Default is allowed, matching the previous invoice behavior.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.allow_invoice_selling_price) {
      await queryInterface.addColumn("business", "allow_invoice_selling_price", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "When true, the selling price can be changed on a sales invoice. When false, the invoice uses the product selling price.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.allow_invoice_selling_price) {
      await queryInterface.removeColumn("business", "allow_invoice_selling_price");
    }
  },
};
