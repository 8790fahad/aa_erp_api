"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "kyc_stakeholders";
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
      first_name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      gender: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      date_of_birth: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      bvn: {
        type: Sequelize.STRING(90),
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

    await queryInterface.addIndex(table, ["kyc_user_id"], {
      name: "kyc_stakeholders_user",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_stakeholders");
  },
};
