"use strict";

/**
 * Add password-reset token columns on kyc_users
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;

    if (!desc.reset_token) {
      await queryInterface.addColumn(table, "reset_token", {
        type: Sequelize.STRING(128),
        allowNull: true,
        comment: "Password reset token (email link)",
      });
    }
    if (!desc.reset_expires) {
      await queryInterface.addColumn(table, "reset_expires", {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Expiry for reset_token",
      });
    }
  },

  async down(queryInterface) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (desc.reset_expires) await queryInterface.removeColumn(table, "reset_expires");
    if (desc.reset_token) await queryInterface.removeColumn(table, "reset_token");
  },
};
