"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (!desc.kyc_submitted_at) {
      await queryInterface.addColumn(table, "kyc_submitted_at", {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "When the client submitted KYC details for admin review",
      });
    }
  },

  async down(queryInterface) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (desc.kyc_submitted_at) {
      await queryInterface.removeColumn(table, "kyc_submitted_at");
    }
  },
};
