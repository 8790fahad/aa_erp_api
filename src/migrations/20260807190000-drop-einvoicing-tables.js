"use strict";

/**
 * Remove FIRS / NRS e-invoicing tables (feature removed from product).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=0");
    try {
      await queryInterface.dropTable("nrs_einvoices").catch(() => {});
      await queryInterface.dropTable("einvoicing_clients").catch(() => {});
    } finally {
      await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=1");
    }
  },

  async down() {
    // Intentionally not recreating e-invoicing tables.
  },
};
