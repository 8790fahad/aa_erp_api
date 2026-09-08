"use strict";

/**
 * Vendor type: inventory | expense | all.
 * Inventory vendors appear on inventory bills; expense vendors on expense bills and imprest;
 * "all" vendors appear on every list. Existing rows stay NULL and remain visible on both lists.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const cols = await queryInterface
      .describeTable("suppliersinfo")
      .catch(() => null);
    if (!cols) return;

    if (!cols.vendor_type) {
      await queryInterface.addColumn("suppliersinfo", "vendor_type", {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
        comment: "inventory | expense | all — which bill/imprest lists this vendor appears on",
      });
    }

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `suppliersinfo` WHERE Key_name = 'idx_suppliersinfo_vendor_type'",
    );
    if (!indexes.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `suppliersinfo` ADD INDEX `idx_suppliersinfo_vendor_type` (`vendor_type`)",
      );
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query(
        "ALTER TABLE `suppliersinfo` DROP INDEX `idx_suppliersinfo_vendor_type`",
      )
      .catch(() => {});
    await queryInterface
      .removeColumn("suppliersinfo", "vendor_type")
      .catch(() => {});
  },
};
