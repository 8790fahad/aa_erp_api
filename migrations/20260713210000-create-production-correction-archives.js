"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("production_correction_archives", {
      id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      batch_no: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      costing_record_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      reason: {
        type: Sequelize.ENUM("correct", "delete"),
        allowNull: false,
        defaultValue: "correct",
      },
      archived_by: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      archived_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      store_entries: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      ledger_entries: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      costing_data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      meta: {
        type: Sequelize.JSON,
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

    await queryInterface.addIndex("production_correction_archives", [
      "facility_id",
      "batch_no",
    ]);
    await queryInterface.addIndex("production_correction_archives", [
      "archived_at",
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("production_correction_archives");
    await queryInterface.sequelize.query(
      "DROP TYPE IF EXISTS enum_production_correction_archives_reason;",
    );
  },
};
