"use strict";

/** Custom username for marketplace link (e.g. aa_erp.org/i/myshop). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("business", "link_user", {
      type: Sequelize.STRING(50),
      allowNull: true,
      unique: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("business", "link_user");
  },
};
