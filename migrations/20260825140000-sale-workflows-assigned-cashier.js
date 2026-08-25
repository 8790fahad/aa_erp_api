"use strict";

/** Assign a cashier (user id) on invoice create for Collection Points filtering. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("sale_workflows");
    if (!table.assigned_cashier_id) {
      await queryInterface.addColumn("sale_workflows", "assigned_cashier_id", {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "User id of assigned cashier for Collection Points",
      });
    }
    if (!table.assigned_cashier_name) {
      await queryInterface.addColumn("sale_workflows", "assigned_cashier_name", {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }
    try {
      await queryInterface.addIndex("sale_workflows", ["assigned_cashier_id"], {
        name: "sale_workflows_assigned_cashier_id",
      });
    } catch (_) {
      /* index may already exist */
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex(
        "sale_workflows",
        "sale_workflows_assigned_cashier_id",
      );
    } catch (_) {
      /* ignore */
    }
    const table = await queryInterface.describeTable("sale_workflows");
    if (table.assigned_cashier_name) {
      await queryInterface.removeColumn("sale_workflows", "assigned_cashier_name");
    }
    if (table.assigned_cashier_id) {
      await queryInterface.removeColumn("sale_workflows", "assigned_cashier_id");
    }
  },
};
