"use strict";

/** business_logo stores base64 or Cloudinary URLs; VARCHAR(100) is too small. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("business", "business_logo", {
      type: Sequelize.TEXT("long"),
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("business", "business_logo", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },
};
