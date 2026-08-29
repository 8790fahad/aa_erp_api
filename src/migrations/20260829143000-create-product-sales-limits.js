"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = (tables || []).map((t) =>
      String(typeof t === "string" ? t : t.tableName || t.name || "").toLowerCase(),
    );
    if (names.includes("product_sales_limits")) return;

    await queryInterface.createTable("product_sales_limits", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      sku: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      branch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      period: {
        type: Sequelize.ENUM("daily", "weekly", "monthly"),
        allowNull: false,
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("product_sales_limits", {
      unique: true,
      fields: ["facility_id", "sku", "branch_id"],
      name: "product_sales_limits_facility_sku_branch",
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = (tables || []).map((t) =>
      String(typeof t === "string" ? t : t.tableName || t.name || "").toLowerCase(),
    );
    if (!names.includes("product_sales_limits")) return;
    await queryInterface.dropTable("product_sales_limits");
  },
};
