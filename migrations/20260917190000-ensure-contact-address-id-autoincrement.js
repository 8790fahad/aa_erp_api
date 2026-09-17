"use strict";

const { ensureAutoIncrementId } = require("./lib/ensureAutoIncrementId");

/**
 * Re-apply AUTO_INCREMENT after phpMyAdmin dumps imported tables without
 * indexes. The earlier migration may already be in SequelizeMeta.
 */
module.exports = {
  async up(queryInterface) {
    for (const table of [
      "customer_contacts",
      "customer_addresses",
      "supplier_contacts",
      "supplier_addresses",
    ]) {
      await ensureAutoIncrementId(queryInterface, table);
    }
  },

  async down() {},
};
