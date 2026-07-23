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
    if (await tableExists(queryInterface, "sale_workflows")) return;

    await queryInterface.createTable("sale_workflows", {
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
      customer_no: { type: Sequelize.STRING(50), allowNull: true },
      customer_name: { type: Sequelize.STRING(150), allowNull: true },
      payment_type: {
        type: Sequelize.ENUM("credit", "cash", "transfer", "split", "bank"),
        allowNull: false,
        defaultValue: "credit",
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: "submitted",
      },
      amount: { type: Sequelize.DECIMAL(20, 2), allowNull: true },
      branch_id: { type: Sequelize.INTEGER, allowNull: true },
      hold_overnight: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      history: { type: Sequelize.JSON, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.STRING(50), allowNull: true },
      updated_by: { type: Sequelize.STRING(50), allowNull: true },
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

    await queryInterface.addIndex("sale_workflows", ["facility_id", "sale_code"], {
      unique: true,
      name: "sale_workflows_facility_sale_unique",
    });
    await queryInterface.addIndex("sale_workflows", ["status"]);
    await queryInterface.addIndex("sale_workflows", ["payment_type"]);
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, "sale_workflows")) {
      await queryInterface.dropTable("sale_workflows");
    }
  },
};
