"use strict";

/**
 * Add approved_qty to requisition_details so purchase requisition approval
 * can store per-line approved quantities separately from requested quantity.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("requisition_details")
      .catch(() => null);
    if (!cols) return;

    if (!cols.approved_qty) {
      await queryInterface.addColumn("requisition_details", "approved_qty", {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: null,
        comment: "Quantity approved at requisition approval",
      });
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface
      .removeColumn("requisition_details", "approved_qty")
      .catch(() => {});
  },
};
