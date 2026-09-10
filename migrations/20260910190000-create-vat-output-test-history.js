"use strict";

/** Saved VAT output test-copy divisor: one year+month per facility. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("vat_output_test_history")) return;

    await queryInterface.createTable("vat_output_test_history", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      month: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      divisor: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      output_vat: {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      invoice_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      selected_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      selected_codes: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      previewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_by: {
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
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("vat_output_test_history", {
      unique: true,
      name: "vat_output_test_history_facility_year_month",
      fields: ["facility_id", "year", "month"],
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t.tableName || t).toLowerCase(),
    );
    if (!names.includes("vat_output_test_history")) return;
    await queryInterface.dropTable("vat_output_test_history");
  },
};
