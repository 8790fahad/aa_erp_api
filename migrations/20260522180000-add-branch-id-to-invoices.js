"use strict";

/**
 * Add branchId column to invoices table so that sales / purchase invoices
 * can be filtered by branch on the Invoice list and other reports.
 *
 * The column is nullable (defaults to NULL) because legacy invoices won't
 * have a branch associated with them. An index is added for fast filtering.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("invoices")
      .catch(() => null);
    if (!cols) return; // table doesn't exist yet (fresh install)

    if (!cols.branchId) {
      await queryInterface.addColumn("invoices", "branchId", {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: "Branch (id from branches table) this invoice belongs to",
      });
    }

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `invoices` WHERE Key_name = 'idx_invoices_branchId'"
    );
    if (!indexes.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `invoices` ADD INDEX `idx_invoices_branchId` (`branchId`)"
      );
    }

    // Also add a composite index for the most common access pattern:
    // filter by facility_id + branchId + type.
    const [composite] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `invoices` WHERE Key_name = 'idx_invoices_facility_branch_type'"
    );
    if (!composite.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `invoices` ADD INDEX `idx_invoices_facility_branch_type` (`facility_id`, `branchId`, `type`)"
      );
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query(
        "ALTER TABLE `invoices` DROP INDEX `idx_invoices_facility_branch_type`"
      )
      .catch(() => {});
    await queryInterface.sequelize
      .query("ALTER TABLE `invoices` DROP INDEX `idx_invoices_branchId`")
      .catch(() => {});
    await queryInterface
      .removeColumn("invoices", "branchId")
      .catch(() => {});
  },
};
