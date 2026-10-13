"use strict";

/**
 * Speed up New Invoice stock lookup, which filters store_entries by facility
 * and product before summing qty.
 */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [rows] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM `store_entries` WHERE Key_name = 'idx_store_entries_facility_product'",
    );
    if (rows && rows.length) return;

    await queryInterface.sequelize.query(
      "ALTER TABLE `store_entries` ADD INDEX `idx_store_entries_facility_product` (`facilityId`, `product_id`, `branchId`)",
    );
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;
    await queryInterface.sequelize
      .query(
        "ALTER TABLE `store_entries` DROP INDEX `idx_store_entries_facility_product`",
      )
      .catch(() => {});
  },
};
