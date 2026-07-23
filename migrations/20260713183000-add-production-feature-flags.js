"use strict";

/** Feature flags for production correction and material requisition. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.enable_production_correction) {
      await queryInterface.addColumn("business", "enable_production_correction", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "When true, production correction tools are available",
      });
    }

    if (!table.enable_material_requisition) {
      await queryInterface.addColumn("business", "enable_material_requisition", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "When true, Material Requisition is available in Production",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.enable_production_correction) {
      await queryInterface.removeColumn("business", "enable_production_correction");
    }
    if (table.enable_material_requisition) {
      await queryInterface.removeColumn("business", "enable_material_requisition");
    }
  },
};
