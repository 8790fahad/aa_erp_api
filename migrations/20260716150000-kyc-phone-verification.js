"use strict";

/**
 * Migration: KYC phone verification columns on kyc_users
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;

    if (!desc.phone_verified) {
      await queryInterface.addColumn(table, "phone_verified", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Set true after signup SMS OTP is confirmed",
      });
    }
    if (!desc.phone_code) {
      await queryInterface.addColumn(table, "phone_code", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Signup phone OTP (sha256 hex hash)",
      });
    } else {
      // Widen if previously created as STRING(10) for plaintext OTPs.
      await queryInterface.changeColumn(table, "phone_code", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Signup phone OTP (sha256 hex hash)",
      });
    }
    if (!desc.phone_code_expires) {
      await queryInterface.addColumn(table, "phone_code_expires", {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Expiry for phone_code",
      });
    }
    // Login OTP (`code`) is also stored hashed — widen from STRING(10) if needed.
    if (desc.code) {
      await queryInterface.changeColumn(table, "code", {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: "Login OTP (sha256 hex hash)",
      });
    }

    // Legacy accounts that already verified email (or are verified/approved)
    // are treated as phone-verified. email_verified may be missing if the
    // auth-fields migration has not run yet — fall back to status only.
    const fresh = await queryInterface.describeTable(table);
    if (fresh.email_verified) {
      await queryInterface.sequelize.query(`
        UPDATE kyc_users
        SET phone_verified = true
        WHERE email_verified = true
           OR status IN ('verified', 'approved')
      `);
    } else {
      await queryInterface.sequelize.query(`
        UPDATE kyc_users
        SET phone_verified = true
        WHERE status IN ('verified', 'approved')
      `);
    }
  },

  async down(queryInterface) {
    const table = "kyc_users";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (desc.phone_code_expires) {
      await queryInterface.removeColumn(table, "phone_code_expires");
    }
    if (desc.phone_code) {
      await queryInterface.removeColumn(table, "phone_code");
    }
    if (desc.phone_verified) {
      await queryInterface.removeColumn(table, "phone_verified");
    }
  },
};
