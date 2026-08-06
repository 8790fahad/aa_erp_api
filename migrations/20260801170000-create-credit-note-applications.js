"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t.tableName || t).toLowerCase(),
    );
    if (names.includes("credit_note_applications")) return;

    await queryInterface.createTable("credit_note_applications", {
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
      credit_note_number: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      invoice_ref: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      amount: {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("credit_note_applications", ["facility_id", "credit_note_number"], {
      name: "idx_cn_app_facility_cn",
    });
    await queryInterface.addIndex("credit_note_applications", ["facility_id", "invoice_ref"], {
      name: "idx_cn_app_facility_inv",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("credit_note_applications");
  },
};
