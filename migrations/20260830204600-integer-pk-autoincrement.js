"use strict";

/**
 * Sequelize inserts DEFAULT for integer PKs. When the live column is NOT
 * AUTO_INCREMENT (and sql_mode has NO_AUTO_VALUE_ON_ZERO), the first row
 * gets 0 and the next INSERT fails with Duplicate entry '0' for PRIMARY.
 *
 * Seen on: logs.id, requisition_details.id, general_ledger.transaction_id.
 * Fix every single-column integer PRIMARY KEY that is missing AUTO_INCREMENT.
 */

const SKIP = new Set(["sequelizemeta"]);

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const [rows] = await sequelize.query(`
      SELECT
        c.TABLE_NAME AS tableName,
        c.COLUMN_NAME AS columnName,
        c.COLUMN_TYPE AS columnType
      FROM information_schema.COLUMNS c
      INNER JOIN information_schema.STATISTICS s
        ON s.TABLE_SCHEMA = c.TABLE_SCHEMA
       AND s.TABLE_NAME = c.TABLE_NAME
       AND s.COLUMN_NAME = c.COLUMN_NAME
       AND s.INDEX_NAME = 'PRIMARY'
       AND s.SEQ_IN_INDEX = 1
      WHERE c.TABLE_SCHEMA = DATABASE()
        AND c.DATA_TYPE IN ('int', 'bigint', 'mediumint', 'smallint', 'tinyint')
        AND c.EXTRA NOT LIKE '%auto_increment%'
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.STATISTICS s2
          WHERE s2.TABLE_SCHEMA = c.TABLE_SCHEMA
            AND s2.TABLE_NAME = c.TABLE_NAME
            AND s2.INDEX_NAME = 'PRIMARY'
            AND s2.SEQ_IN_INDEX = 2
        )
      ORDER BY c.TABLE_NAME
    `);

    for (const row of rows || []) {
      const table = String(row.tableName);
      const column = String(row.columnName);
      if (SKIP.has(table.toLowerCase())) continue;

      const [maxRows] = await sequelize.query(
        `SELECT COALESCE(MAX(\`${column}\`), 0) AS max_id FROM \`${table}\``,
      );
      const next = Number(maxRows?.[0]?.max_id || 0) + 1;
      const colType = String(row.columnType || "int(11)");

      try {
        await sequelize.query(
          `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${colType} NOT NULL AUTO_INCREMENT`,
        );
        await sequelize.query(
          `ALTER TABLE \`${table}\` AUTO_INCREMENT = ${next}`,
        );
      } catch (err) {
        console.warn(
          `  ⚠ skip AUTO_INCREMENT on ${table}.${column}: ${err.message}`,
        );
      }
    }
  },

  async down() {
    // Keep AUTO_INCREMENT; reverting would break inserts again.
  },
};
