"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("saved_reports", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      report_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      account_codes: {
        type: Sequelize.TEXT,
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
      facility_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      created_by: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("saved_reports", ["facility_id"], {
      name: "idx_saved_reports_facility_id",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("saved_reports");
  },
};

