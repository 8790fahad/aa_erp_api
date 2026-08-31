"use strict";

/**
 * Local MariaDB (NO_ZERO_DATE) rejects ALTER TABLE on memo because
 * updatedAt is TIMESTAMP DEFAULT '0000-00-00 00:00:00'.
 * Sequelize sync adding indexes rebuilds the table and throws.
 */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable("memo");
    if (!table.updatedAt) return;

    await queryInterface.sequelize.query(
      "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'",
    );
    await queryInterface.sequelize.query(`
      ALTER TABLE memo
        MODIFY COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        MODIFY COLUMN updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `);
  },

  async down() {
    // Keep valid timestamp defaults; do not restore zero dates.
  },
};
