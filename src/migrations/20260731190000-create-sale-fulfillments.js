"use strict";

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const normalized = tables.map((t) =>
    typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
  );
  return normalized.includes(tableName.toLowerCase());
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, "sale_fulfillments"))) {
      await queryInterface.createTable("sale_fulfillments", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        sale_code: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        branch_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        pack_code: {
          type: Sequelize.STRING(80),
          allowNull: false,
        },
        status: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: "pending",
        },
        printed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        collected_at: {
          type: Sequelize.DATE,
          allowNull: true,
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

      await queryInterface.addIndex(
        "sale_fulfillments",
        ["facility_id", "sale_code", "branch_id"],
        {
          unique: true,
          name: "sale_fulfillments_facility_sale_branch_unique",
        },
      );
      await queryInterface.addIndex("sale_fulfillments", ["status"]);
      await queryInterface.addIndex("sale_fulfillments", ["branch_id"]);
      await queryInterface.addIndex("sale_fulfillments", ["pack_code"]);
    }

    if (!(await tableExists(queryInterface, "sale_fulfillment_lines"))) {
      await queryInterface.createTable("sale_fulfillment_lines", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        fulfillment_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        product_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        item_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        qty: {
          type: Sequelize.DECIMAL(20, 4),
          allowNull: false,
          defaultValue: 0,
        },
        qty_collected: {
          type: Sequelize.DECIMAL(20, 4),
          allowNull: false,
          defaultValue: 0,
        },
        store_entry_id: {
          type: Sequelize.INTEGER,
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

      await queryInterface.addIndex("sale_fulfillment_lines", [
        "fulfillment_id",
      ]);
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, "sale_fulfillment_lines")) {
      await queryInterface.dropTable("sale_fulfillment_lines");
    }
    if (await tableExists(queryInterface, "sale_fulfillments")) {
      await queryInterface.dropTable("sale_fulfillments");
    }
  },
};
