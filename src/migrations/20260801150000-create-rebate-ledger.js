"use strict";

/** Create rebate_rules + rebate_statuses tables for Rebate Ledger. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
    );

    if (!names.includes("rebate_rules")) {
      await queryInterface.createTable("rebate_rules", {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        product_name: {
          type: Sequelize.STRING(255),
          allowNull: false,
          defaultValue: "All products",
        },
        product_sku: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        period_label: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        from_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        to_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        min_qty: {
          type: Sequelize.DECIMAL(20, 4),
          allowNull: false,
          defaultValue: 0,
        },
        rebate_percent: {
          type: Sequelize.DECIMAL(10, 4),
          allowNull: false,
          defaultValue: 0,
        },
        created_by: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        updated_by: {
          type: Sequelize.STRING(50),
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
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex("rebate_rules", ["facility_id"], {
        name: "idx_rebate_rules_facility",
      });
    }

    if (!names.includes("rebate_statuses")) {
      await queryInterface.createTable("rebate_statuses", {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        rule_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "rebate_rules", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        customer_name: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        customer_no: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM("pending", "approved", "paid"),
          allowNull: false,
          defaultValue: "pending",
        },
        payout_type: {
          type: Sequelize.ENUM("credit", "cash"),
          allowNull: false,
          defaultValue: "credit",
        },
        updated_by: {
          type: Sequelize.STRING(50),
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
          defaultValue: Sequelize.literal(
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
          ),
        },
      });
      await queryInterface.addIndex(
        "rebate_statuses",
        ["facility_id", "rule_id", "customer_name"],
        {
          unique: true,
          name: "uq_rebate_status_customer_rule",
        },
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("rebate_statuses");
    await queryInterface.dropTable("rebate_rules");
  },
};
