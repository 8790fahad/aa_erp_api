"use strict";

/**
 * Backfill store_entries.type with movement types (sales, purchase, etc.)
 * instead of product categories or legacy labels.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const sql = queryInterface.sequelize;

    // Normalize legacy labels → canonical movement types
    await sql.query(`
      UPDATE store_entries
      SET type = 'transfer'
      WHERE type IN ('Goods Transfer', 'transfer')
    `);

    await sql.query(`
      UPDATE store_entries
      SET type = 'production'
      WHERE type IN (
        'Raw Material', 'Finished Good', 'By-Product', 'Resalable', 'Semi Finished',
        'WIP', 'WIP Return', 'Raw Material Return', 'Mixture Consumption',
        'Semi Finished Production', 'production'
      )
    `);

    await sql.query(`
      UPDATE store_entries
      SET type = 'adjustment'
      WHERE type IN ('WIP Write-off', 'Write-off', 'adjustment')
    `);

    // Sales outflows (keep credit / cash / pro-bono / sales when already set)
    await sql.query(`
      UPDATE store_entries
      SET type = 'credit'
      WHERE qty_out > 0
        AND (destination = 'sold' OR LOWER(TRIM(source)) = 'for sales')
        AND type NOT IN ('sales', 'credit', 'cash', 'pro-bono', 'transfer', 'adjustment')
    `);

    // Purchases / GRN
    await sql.query(`
      UPDATE store_entries
      SET type = 'purchase'
      WHERE qty_in > 0
        AND (
          source LIKE 'Purchase%'
          OR source LIKE 'Direct Purchase%'
          OR source LIKE 'Goods Received%'
        )
        AND type NOT IN ('purchase', 'opening_balance', 'production', 'transfer')
    `);

    // Opening / initial stock
    await sql.query(`
      UPDATE store_entries
      SET type = 'opening_balance'
      WHERE qty_in > 0
        AND source = 'Initial Stock'
        AND type NOT IN ('opening_balance', 'purchase', 'production', 'transfer')
    `);

    console.log("[backfill-store-entries-movement-type] complete");
  },

  down: async () => {
    // Data backfill — no safe automatic rollback.
  },
};
