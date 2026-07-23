"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("production_records", "batch_no", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn("production_manufacturing_records", "batch_no", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn("production_costing_records", "batch_no", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addIndex("production_records", ["facility_id", "batch_no"], {
      name: "idx_production_records_facility_batch_no",
    });

    await queryInterface.addIndex(
      "production_manufacturing_records",
      ["facility_id", "batch_no"],
      {
        name: "idx_production_manufacturing_facility_batch_no",
      },
    );

    await queryInterface.addIndex(
      "production_costing_records",
      ["facility_id", "batch_no"],
      {
        name: "idx_production_costing_facility_batch_no",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "production_costing_records",
      "idx_production_costing_facility_batch_no",
    );
    await queryInterface.removeIndex(
      "production_manufacturing_records",
      "idx_production_manufacturing_facility_batch_no",
    );
    await queryInterface.removeIndex(
      "production_records",
      "idx_production_records_facility_batch_no",
    );

    await queryInterface.removeColumn("production_costing_records", "batch_no");
    await queryInterface.removeColumn("production_manufacturing_records", "batch_no");
    await queryInterface.removeColumn("production_records", "batch_no");
  },
};
