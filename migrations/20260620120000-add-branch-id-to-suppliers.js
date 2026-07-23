"use strict";

/**
 * Add branch_id column to suppliersinfo so a payee can be associated with
 * the branch/location where they were registered.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("suppliersinfo")
      .catch(() => null);
    if (!cols) return;

    if (!cols.branch_id) {
      await queryInterface.addColumn("suppliersinfo", "branch_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Branch (id from branches table) this supplier belongs to",
      });
    }

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `suppliersinfo` WHERE Key_name = 'idx_suppliersinfo_branch_id'",
    );
    if (!indexes.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `suppliersinfo` ADD INDEX `idx_suppliersinfo_branch_id` (`branch_id`)",
      );
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query(
        "ALTER TABLE `suppliersinfo` DROP INDEX `idx_suppliersinfo_branch_id`",
      )
      .catch(() => {});
    await queryInterface
      .removeColumn("suppliersinfo", "branch_id")
      .catch(() => {});
  },
};
