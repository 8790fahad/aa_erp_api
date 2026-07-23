"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await queryInterface
      .describeTable("kyc_business_information")
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    await queryInterface.createTable("kyc_business_information", {
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
      legal_name: { type: Sequelize.STRING(255), allowNull: true },
      trading_name: { type: Sequelize.STRING(255), allowNull: true },
      business_type: { type: Sequelize.STRING(80), allowNull: true },
      registration_number: { type: Sequelize.STRING(80), allowNull: true },
      tin: { type: Sequelize.STRING(80), allowNull: true },
      address_line1: { type: Sequelize.STRING(255), allowNull: true },
      address_line2: { type: Sequelize.STRING(255), allowNull: true },
      city: { type: Sequelize.STRING(120), allowNull: true },
      state: { type: Sequelize.STRING(120), allowNull: true },
      country: {
        type: Sequelize.STRING(2),
        allowNull: true,
        defaultValue: "NG",
      },
      postal_code: { type: Sequelize.STRING(40), allowNull: true },
      industry: { type: Sequelize.STRING(255), allowNull: true },
      website: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
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

    await queryInterface.addIndex("kyc_business_information", ["kyc_user_id"], {
      name: "kyc_business_information_user",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_business_information");
  },
};
