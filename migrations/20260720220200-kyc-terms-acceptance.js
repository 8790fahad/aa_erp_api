"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await queryInterface
      .describeTable("kyc_terms_acceptance")
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    await queryInterface.createTable("kyc_terms_acceptance", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      kyc_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "kyc_users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      terms_version: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      accepted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      accepted_at: { type: Sequelize.DATE, allowNull: true },
      accepted_ip: { type: Sequelize.STRING(64), allowNull: true },
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

    await queryInterface.addIndex("kyc_terms_acceptance", ["kyc_user_id"], {
      name: "kyc_terms_acceptance_user",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_terms_acceptance");
  },
};
