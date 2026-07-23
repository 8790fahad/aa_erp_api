"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("kyc_users", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      business_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(2),
        allowNull: true,
        defaultValue: "NG",
      },
      first_name: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      last_name: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      code: {
        type: Sequelize.STRING(10),
        allowNull: true,
      },
      expiring_code: {
        type: Sequelize.DATE,
        allowNull: true,
      },
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_users");
  },
};
