"use strict";

/**
 * Adds `branches.is_default` so a business can mark one branch as its default
 * (used to preselect a branch in sales/inventory flows). Only one branch per
 * facility should be default — the controllers enforce that on create/update.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface.describeTable("branches").catch(() => null);
    if (cols && !cols.is_default) {
      await queryInterface.addColumn("branches", "is_default", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Default branch for the facility (only one should be true).",
      });
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;
    await queryInterface.removeColumn("branches", "is_default").catch(() => {});
  },
};
