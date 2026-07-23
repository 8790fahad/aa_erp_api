"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("production_manufacturing_records", {
      id: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      production_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM("job_specific", "joint_shared"),
        allowNull: false,
        defaultValue: "job_specific",
      },
      production_line: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM("draft", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: false,
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable("production_manufacturing_records");
    await queryInterface.sequelize.query(
      "DROP TYPE IF EXISTS enum_production_manufacturing_records_type;",
    );
    await queryInterface.sequelize.query(
      "DROP TYPE IF EXISTS enum_production_manufacturing_records_status;",
    );
  },
};
