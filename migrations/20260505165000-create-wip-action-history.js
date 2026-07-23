"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'wip_action_history';"
    );
    if (Array.isArray(tables) && tables.length > 0) return;

    await queryInterface.createTable("wip_action_history", {
      id: {
        type: Sequelize.UUID,
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
      name: "idx_wip_action_history_facility",
    });
    await queryInterface.addIndex("wip_action_history", ["reference_number"], {
      name: "idx_wip_action_history_ref",
    });
    await queryInterface.addIndex("wip_action_history", ["product_id"], {
      name: "idx_wip_action_history_product",
    });
    await queryInterface.addIndex("wip_action_history", ["action_type"], {
      name: "idx_wip_action_history_action_type",
    });
    await queryInterface.addIndex("wip_action_history", ["created_at"], {
      name: "idx_wip_action_history_created_at",
    });
  },

  down: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface
      .removeIndex("wip_action_history", "idx_wip_action_history_created_at")
      .catch(() => {});
    await queryInterface
      .removeIndex("wip_action_history", "idx_wip_action_history_action_type")
      .catch(() => {});
    await queryInterface
      .removeIndex("wip_action_history", "idx_wip_action_history_product")
      .catch(() => {});
    await queryInterface
      .removeIndex("wip_action_history", "idx_wip_action_history_ref")
      .catch(() => {});
    await queryInterface
      .removeIndex("wip_action_history", "idx_wip_action_history_facility")
      .catch(() => {});

    await queryInterface.dropTable("wip_action_history").catch(() => {});

    if (dialect === "mysql" || dialect === "mariadb") {
      await queryInterface.sequelize
        .query("DROP TYPE IF EXISTS `enum_wip_action_history_action_type`;")
        .catch(() => {});
    }
  },
};
