"use strict";

/**
 * Add branch_id column to customers table so a customer can be associated with
 * the branch/location where they were registered.
 *
 * The column is nullable because legacy customers won't have a branch. An index
 * is added for fast filtering by branch.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("customers")
      .catch(() => null);
    if (!cols) return; // table doesn't exist yet (fresh install)

    if (!cols.branch_id) {
      await queryInterface.addColumn("customers", "branch_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Branch (id from branches table) this customer belongs to",
      });
    }

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `customers` WHERE Key_name = 'idx_customers_branch_id'"
    );
    if (!indexes.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `customers` ADD INDEX `idx_customers_branch_id` (`branch_id`)"
      );
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query("ALTER TABLE `customers` DROP INDEX `idx_customers_branch_id`")
      .catch(() => {});
    await queryInterface.removeColumn("customers", "branch_id").catch(() => {});
  },
};
