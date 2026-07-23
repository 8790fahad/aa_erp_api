"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_service_settings";
    const exists = await queryInterface
      .describeTable(table)
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    await queryInterface.createTable(table, {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      kyc_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "kyc_users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      service: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: "e_invoice",
        comment: "Integration service key, e.g. e_invoice",
      },
      nrs_business_id: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      nrs_service_id: {
        type: Sequelize.STRING(40),
        allowNull: true,
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

    await queryInterface.addIndex(table, ["kyc_user_id", "service"], {
      name: "kyc_service_settings_user_service",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_service_settings");
  },
};
