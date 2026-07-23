"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("kyc_contact_information", {
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
      title: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      first_name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: false,
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

    await queryInterface.addIndex("kyc_contact_information", ["kyc_user_id"], {
      name: "kyc_contact_information_user",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_contact_information");
  },
};
