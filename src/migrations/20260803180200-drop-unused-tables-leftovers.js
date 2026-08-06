"use strict";

/**
 * Cleanup leftovers from 20260803180100 where mixed-case table names
 * (e.g. Teams) or Sequelize-pluralized duplicates (asset_maintenances)
 * were not removed reliably.
 */

// Teams intentionally excluded — live Admin/Teams module uses it.
const LEFTOVERS = ["asset_maintenances"];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=0");
    try {
      for (const table of LEFTOVERS) {
        // Prefer unquoted DROP for mixed-case names on macOS MySQL
        // (quoted `Teams` can no-op under lower_case_table_names).
        try {
          await queryInterface.sequelize.query(`DROP TABLE ${table}`);
        } catch (_) {
          const safe = String(table).replace(/`/g, "``");
          await queryInterface.sequelize.query(
            `DROP TABLE IF EXISTS \`${safe}\``,
          );
        }
      }
    } finally {
      await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=1");
    }
  },

  async down() {
    console.warn(
      "[20260803180200-drop-unused-tables-leftovers] down(): no-op",
    );
  },
};
