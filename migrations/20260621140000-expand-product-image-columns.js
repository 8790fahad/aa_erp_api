"use strict";

/** image_url may store URLs; product_images JSON stores URL arrays after upload. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("products", "image_url", {
      type: Sequelize.TEXT("long"),
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("products", "image_url", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },
};
