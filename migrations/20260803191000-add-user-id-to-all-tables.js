"use strict";

/**
 * Ensure every business table has a `user_id` column for mutation accountability.
 * - Adds nullable VARCHAR(50) when missing
 * - Backfills from created_by / createdBy / updated_by / updatedBy when present
 * Skips SequelizeMeta and users (identity table).
 */

const SKIP = new Set(["sequelizemeta", "users"]);

function qName(name) {
  return `\`${String(name).replace(/`/g, "")}\``;
}

async function listBaseTables(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  return rows.map((r) => r.name);
}

async function columnNames(queryInterface, tableName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    { replacements: { tableName } },
  );
  return rows.map((r) => r.name);
}

function findSourceCol(cols) {
  const lower = cols.map((c) => c.toLowerCase());
  const prefer = [
    "created_by",
    "createdby",
    "updated_by",
    "updatedby",
    "userid",
    "processed_by",
    "inserted_by",
    "created_by_id",
  ];
  for (const p of prefer) {
    const idx = lower.indexOf(p);
    if (idx >= 0) return cols[idx];
  }
  return null;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await listBaseTables(queryInterface);
    const added = [];

    for (const table of tables) {
      if (SKIP.has(String(table).toLowerCase())) continue;

      const cols = await columnNames(queryInterface, table);
      const lower = new Set(cols.map((c) => c.toLowerCase()));
      if (lower.has("user_id")) continue;

      await queryInterface.addColumn(table, "user_id", {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Acting / owning user id for create-update-delete tracking",
      });
      added.push(table);

      const source = findSourceCol(cols);
      if (source) {
        await queryInterface.sequelize.query(
          `UPDATE ${qName(table)}
           SET user_id = CAST(${qName(source)} AS CHAR)
           WHERE user_id IS NULL
             AND ${qName(source)} IS NOT NULL
             AND CAST(${qName(source)} AS CHAR) != ''`,
        );
      }
    }

    console.log(
      `[add-user-id] added user_id to ${added.length} tables` +
        (added.length ? `: ${added.slice(0, 20).join(", ")}${added.length > 20 ? "…" : ""}` : ""),
    );
  },

  async down(queryInterface) {
    const tables = await listBaseTables(queryInterface);
    for (const table of tables) {
      if (SKIP.has(String(table).toLowerCase())) continue;
      const cols = await columnNames(queryInterface, table);
      const lower = new Set(cols.map((c) => c.toLowerCase()));
      // Only drop if we likely added it and there was no prior user_id —
      // safer: skip down for mass schema change in production.
      if (!lower.has("user_id")) continue;
      // Do not auto-drop on down — too destructive / ambiguous with pre-existing columns.
    }
    console.log("[add-user-id] down is a no-op (columns left in place)");
  },
};
