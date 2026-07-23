"use strict";

/**
 * Widen kyc_users.code / phone_code to hold sha256 hex OTP hashes (64 chars).
 * Older columns were VARCHAR(10) for plaintext 6-digit OTPs.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;

    if (desc.code) {
      await queryInterface.changeColumn(table, "code", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Login OTP (sha256 hex hash)",
      });
    }

    if (desc.phone_code) {
      await queryInterface.changeColumn(table, "phone_code", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Signup phone OTP (sha256 hex hash)",
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;

    // Only shrink if values still fit; otherwise leave wide.
    if (desc.code) {
      await queryInterface.changeColumn(table, "code", {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
    if (desc.phone_code) {
      await queryInterface.changeColumn(table, "phone_code", {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
  },
};
