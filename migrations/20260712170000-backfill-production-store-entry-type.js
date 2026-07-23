"use strict";

/**
 * Fix store_entries where production movements were saved as type "sales"
 * (StoreEntry default) instead of "production".
 *
 * Covers:
 * - Raw material use: Raw Material → Work in Progress
 * - WIP consumption: Work in Progress → Finished Goods / By-Product / Mixture
 * - FG / by-product output: Production → Finished Goods / By-Product / …
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const sql = queryInterface.sequelize;

    await sql.query(`
      UPDATE store_entries
      SET type = 'production'
      WHERE type = 'sales'
        AND (
          (source = 'Raw Material' AND destination = 'Work in Progress')
          OR (
            source = 'Work in Progress'
            AND destination IN ('Finished Goods', 'By-Product', 'Mixture', 'Raw Material')
          )
          OR (
            source = 'Production'
            AND destination IN (
              'Finished Goods',
              'By-Product',
              'Resalable',
              'Semi Finished',
              'Inventory'
            )
          )
          OR (source = 'Mixture' AND destination IN ('Inventory', 'Finished Goods'))
        )
    `);

    console.log("[backfill-production-store-entry-type] complete");
  },

  down: async () => {
    // Data backfill — no safe automatic rollback.
  },
};
