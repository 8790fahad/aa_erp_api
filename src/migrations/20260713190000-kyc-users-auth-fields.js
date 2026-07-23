"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("kyc_users").catch(() => null);
    if (!table) {
      await queryInterface.createTable("kyc_users", {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
          allowNull: false,
        },
        facility_id: { type: Sequelize.STRING(50), allowNull: true },
        business_name: { type: Sequelize.STRING(255), allowNull: true },
        country: {
          type: Sequelize.STRING(2),
          allowNull: true,
          defaultValue: "NG",
        },
        first_name: { type: Sequelize.STRING(120), allowNull: true },
        last_name: { type: Sequelize.STRING(120), allowNull: true },
        email: { type: Sequelize.STRING(150), allowNull: false },
        phone: { type: Sequelize.STRING(30), allowNull: true },
        password: { type: Sequelize.STRING(255), allowNull: true },
        verification_token: { type: Sequelize.STRING(128), allowNull: true },
        verification_expires: { type: Sequelize.DATE, allowNull: true },
        email_verified: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        code: { type: Sequelize.STRING(10), allowNull: true },
        expiring_code: { type: Sequelize.DATE, allowNull: true },
        status: {
          type: Sequelize.ENUM("pending", "verified", "suspended"),
          allowNull: false,
          defaultValue: "pending",
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });
      await queryInterface.addIndex("kyc_users", ["email"], {
        name: "kyc_users_email",
        unique: true,
      });
      return;
    }

    if (!table.password) {
      await queryInterface.addColumn("kyc_users", "password", {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
    if (!table.verification_token) {
      await queryInterface.addColumn("kyc_users", "verification_token", {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }
    if (!table.verification_expires) {
      await queryInterface.addColumn("kyc_users", "verification_expires", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.email_verified) {
      await queryInterface.addColumn("kyc_users", "email_verified", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("kyc_users").catch(() => null);
    if (!table) return;
    if (table.email_verified) await queryInterface.removeColumn("kyc_users", "email_verified");
    if (table.verification_expires)
      await queryInterface.removeColumn("kyc_users", "verification_expires");
    if (table.verification_token)
      await queryInterface.removeColumn("kyc_users", "verification_token");
    if (table.password) await queryInterface.removeColumn("kyc_users", "password");
  },
};
