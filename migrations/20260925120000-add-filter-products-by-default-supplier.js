"use strict";

/** When true, bills and goods received only list products whose default supplier matches the selected vendor. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable("business");
    if (!table.filter_products_by_default_supplier) {
      await queryInterface.addColumn(
        "business",
        "filter_products_by_default_supplier",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      );
    }
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("business");
    if (table.filter_products_by_default_supplier) {
      await queryInterface.removeColumn(
        "business",
        "filter_products_by_default_supplier",
      );
    }
  },
};
