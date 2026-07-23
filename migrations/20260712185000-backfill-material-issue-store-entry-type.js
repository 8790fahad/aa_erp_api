"use strict";

/**
 * Retag Raw Material → WIP material requisition rows as material_issue
 * (issue to WIP is not consumption until production posts).
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      UPDATE store_entries
      SET type = 'material_issue'
      WHERE source = 'Raw Material'
        AND destination = 'Work in Progress'
        AND type IN ('consumed', 'production', 'sales')
    `);

    console.log("[backfill-material-issue-type] complete");
  },

  down: async () => {
    // Data backfill — no safe automatic rollback.
  },
};
