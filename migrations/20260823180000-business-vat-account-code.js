"use strict";

/**
 * Default Output VAT / VAT payable GL head on business settings.
 * Used by VAT Report and as the default tax account head.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "business";
    const columns = await queryInterface.describeTable(table);

    if (!columns.vat_account_code) {
      await queryInterface.addColumn("business", "vat_account_code", {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: "Default VAT account head (Output VAT / VAT payable)",
        after: "vat_policy",
      });
    }
  },

  down: async (queryInterface) => {
    const table = "business";
    const columns = await queryInterface.describeTable(table);
    if (columns.vat_account_code) {
      await queryInterface.removeColumn("business", "vat_account_code");
    }
  },
};
