"use strict";

/** When true, direct supplier bills record Finished Good / Resalable / By-Product lines on sales branch (for sales) store_entries. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      "business",
      "price_setup_resalable_on_purchase",
      {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn(
      "business",
      "price_setup_resalable_on_purchase"
    );
  },
};
