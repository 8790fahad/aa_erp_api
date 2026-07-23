"use strict";

/** Short slug for marketplace tiny link (e.g. flowbooks.org/ma). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("business", "marketplace_slug", {
      type: Sequelize.STRING(50),
      allowNull: true,
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("business", "marketplace_slug");
  },
};
