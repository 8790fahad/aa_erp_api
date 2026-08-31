"use strict";

/**
 * sale_fulfillments / sale_fulfillment_lines were created (or altered) without
 * a PRIMARY KEY or AUTO_INCREMENT. Sequelize then INSERTs id=NULL, which fails
 * with "Column 'id' cannot be null" (NO_AUTO_VALUE_ON_ZERO / strict mode).
 *
 * The earlier integer-pk-autoincrement migration only touches columns that
 * already have a single-column PRIMARY KEY, so these tables were skipped.
 */

const TABLES = ["sale_fulfillments", "sale_fulfillment_lines"];

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    for (const table of TABLES) {
      const [existsRows] = await sequelize.query(
        `SELECT 1 AS ok FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        { replacements: [table] },
      );
      if (!existsRows?.length) continue;

      const [colRows] = await sequelize.query(
        `SELECT COLUMN_TYPE, EXTRA, COLUMN_KEY
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = 'id'`,
        { replacements: [table] },
      );
      const col = colRows?.[0];
      if (!col) continue;

      const extra = String(col.EXTRA || "").toLowerCase();
      const colType = String(col.COLUMN_TYPE || "int(11)");
      const hasPk = String(col.COLUMN_KEY || "").toUpperCase() === "PRI";

      const [maxRows] = await sequelize.query(
        `SELECT COALESCE(MAX(\`id\`), 0) AS max_id FROM \`${table}\``,
      );
      const next = Number(maxRows?.[0]?.max_id || 0) + 1;

      if (!hasPk) {
        await sequelize.query(
          `ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` ${colType} NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (\`id\`)`,
        );
      } else if (!extra.includes("auto_increment")) {
        await sequelize.query(
          `ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` ${colType} NOT NULL AUTO_INCREMENT`,
        );
      }

      await sequelize.query(
        `ALTER TABLE \`${table}\` AUTO_INCREMENT = ${next}`,
      );
    }

    const [idx] = await sequelize.query(
      `SELECT 1 AS ok FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'sale_fulfillments'
         AND INDEX_NAME = 'sale_fulfillments_facility_sale_branch_unique'
       LIMIT 1`,
    );
    if (!idx?.length) {
      try {
        await queryInterface.addIndex(
          "sale_fulfillments",
          ["facility_id", "sale_code", "branch_id"],
          {
            unique: true,
            name: "sale_fulfillments_facility_sale_branch_unique",
          },
        );
      } catch (err) {
        console.warn(
          `  ⚠ skip unique index on sale_fulfillments: ${err.message}`,
        );
      }
    }
  },

  async down() {
    // Keep PRIMARY KEY / AUTO_INCREMENT.
  },
};
