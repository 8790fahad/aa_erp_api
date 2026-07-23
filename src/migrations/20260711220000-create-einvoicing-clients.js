"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("einvoicing_clients", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      business_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      client_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      client_secret_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM("active", "revoked"),
        allowNull: false,
        defaultValue: "active",
      },
      last_used_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex("einvoicing_clients", ["business_id"], {
      name: "einvoicing_clients_business_id",
      unique: true,
    });
    await queryInterface.addIndex("einvoicing_clients", ["client_id"], {
      name: "einvoicing_clients_client_id",
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("einvoicing_clients");
  },
};
