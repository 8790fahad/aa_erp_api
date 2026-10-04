"use strict";

/**
 * Store the expiry date entered on Create Goods received so the inventory
 * bill can take it from the purchase order / goods received line.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("requisition_details")
      .catch(() => null);
    if (!cols || cols.expiry_date) return;

    await queryInterface.addColumn("requisition_details", "expiry_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface
      .removeColumn("requisition_details", "expiry_date")
      .catch(() => {});
  },
};
