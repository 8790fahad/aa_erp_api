"use strict";

/** External short URL for storefront (TinyLink / URL shortener). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("business", "marketplace_tiny_link", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("business", "marketplace_tiny_link");
  },
};
