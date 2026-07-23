"use strict";

/**
 * Retag raw-material / WIP usage qty_out from type "production" to "consumed".
 * Finished-good receipts stay type "production".
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const sql = queryInterface.sequelize;

    await sql.query(`
      UPDATE store_entries
      SET type = 'consumed'
      WHERE type = 'production'
        AND qty_out > 0
        AND (
          (source = 'Raw Material' AND destination = 'Work in Progress')
          OR (
            source = 'Work in Progress'
            AND destination IN ('Finished Goods', 'By-Product', 'Mixture', 'Raw Material')
          )
        )
    `);

    console.log("[backfill-consumed-store-entry-type] complete");
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      UPDATE store_entries
      SET type = 'production'
      WHERE type = 'consumed'
    `);
  },
};
