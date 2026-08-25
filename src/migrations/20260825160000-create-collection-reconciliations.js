"use strict";

/** Cashier supervisor day-end hand-in confirmation (not bank reconciliation). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("collection_reconciliations")) return;

    await queryInterface.createTable("collection_reconciliations", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      branch_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      recon_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      cashier_user_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      cashier_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      expected_cash: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expected_transfer: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expected_total: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_cash: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_transfer: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_total: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_cash: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_transfer: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_total: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "draft",
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      confirmed_by: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      confirmed_by_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      confirmed_at: {
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

    await queryInterface.addIndex(
      "collection_reconciliations",
      ["facility_id", "recon_date", "cashier_user_id", "branch_id"],
      {
        unique: true,
        name: "collection_recon_facility_date_cashier_branch_uq",
      },
    );
    await queryInterface.addIndex("collection_reconciliations", ["facility_id", "recon_date"], {
      name: "collection_recon_facility_date",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("collection_reconciliations");
  },
};
