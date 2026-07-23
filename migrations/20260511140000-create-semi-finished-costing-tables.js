"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'semi_finished_costing_templates';"
    );
    if (Array.isArray(tables) && tables.length > 0) return;

    await queryInterface.createTable("semi_finished_costing_templates", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      product_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      created_by: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex(
      "semi_finished_costing_templates",
      ["facility_id", "product_id"],
      {
        unique: true,
        name: "uniq_semi_finished_costing_facility_product",
      }
    );
    await queryInterface.addIndex(
      "semi_finished_costing_templates",
      ["facility_id"],
      { name: "idx_semi_finished_costing_facility" }
    );

    await queryInterface.createTable("semi_finished_costing_template_items", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      },
      template_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "semi_finished_costing_templates",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      line_index: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: "raw_material",
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      description_code: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      account_head: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      quantity: {
        type: Sequelize.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 0,
      },
      raw_material_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      raw_material_name: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      raw_material_sku: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      other_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      rate: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      unit_cost: {
        type: Sequelize.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 0,
      },
      percentage_basis: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    await queryInterface.addIndex(
      "semi_finished_costing_template_items",
      ["template_id", "line_index"],
      { name: "idx_semi_finished_costing_items_template_line" }
    );
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.dropTable("semi_finished_costing_template_items");
    await queryInterface.dropTable("semi_finished_costing_templates");
  },
};
