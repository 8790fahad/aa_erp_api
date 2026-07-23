"use strict";

/**
 * Collapse legacy store_entries.type values "credit" and "cash" into "sales".
 * Payment method remains on the sale/invoice — not on store_entries.type.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      UPDATE store_entries
      SET type = 'sales'
      WHERE type IN ('credit', 'cash')
    `);

    console.log("[collapse-credit-cash-to-sales] complete");
  },

  down: async () => {
    // Irreversible — payment mode was not stored on type after collapse.
  },
};
