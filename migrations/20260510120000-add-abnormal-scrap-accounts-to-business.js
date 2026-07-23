"use strict";

/**
 * Adds optional GL defaults on `business` for production costing waste journals:
 * - abnormal_loss_account (expense DR for abnormal waste)
 * - scrap_inventory_account (inventory DR for recyclable / by-product)
 *
 * Matches `src/models/business.js` and Account Settings cards (Abnormal Loss / Scrap Inventory).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "business";
    let columns = await queryInterface.describeTable(table);

    if (!columns.abnormal_loss_account) {
      await queryInterface.addColumn(table, "abnormal_loss_account", {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: "Chart account code for abnormal production waste (loss)",
        after: "wip",
      });
      columns = await queryInterface.describeTable(table);
    }

    if (!columns.scrap_inventory_account) {
      const afterCol = columns.abnormal_loss_account
        ? "abnormal_loss_account"
        : "wip";
      await queryInterface.addColumn(table, "scrap_inventory_account", {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: "Chart account code for recyclable scrap inventory",
        after: afterCol,
      });
    }
  },

  down: async (queryInterface) => {
    const table = "business";
    const columns = await queryInterface.describeTable(table);

    if (columns.scrap_inventory_account) {
      await queryInterface.removeColumn(table, "scrap_inventory_account");
    }
    if (columns.abnormal_loss_account) {
      await queryInterface.removeColumn(table, "abnormal_loss_account");
    }
  },
};
