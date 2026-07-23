"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("wip_action_history", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      reference_number: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      product_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      product_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      action_type: {
        type: Sequelize.ENUM("return_raw_material", "write_off"),
        allowNull: false,
      },
      quantity: {
        type: Sequelize.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      unit_cost: {
        type: Sequelize.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      total_cost: {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      source_location: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      destination_location: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("wip_action_history", ["facility_id"], {
      name: "wip_action_history_facility_id",
    });
    await queryInterface.addIndex("wip_action_history", ["product_id"], {
      name: "wip_action_history_product_id",
    });
    await queryInterface.addIndex("wip_action_history", ["action_type"], {
      name: "wip_action_history_action_type",
    });
    await queryInterface.addIndex("wip_action_history", ["reference_number"], {
      name: "wip_action_history_reference_number",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("wip_action_history");
  },
};
