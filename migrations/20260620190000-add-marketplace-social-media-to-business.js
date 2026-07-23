"use strict";

/** Social media handles shown on FlowSpace storefront (JSON object). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("business", "enable_marketplace_social_media", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("business", "marketplace_social_media", {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("business", "marketplace_social_media");
    await queryInterface.removeColumn("business", "enable_marketplace_social_media");
  },
};
