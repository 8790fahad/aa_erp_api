"use strict";

/**
 * Clear leftover product expiry dates so Goods does not split lots.
 *
 * Crown Thick Pasta (P014) at Dawanau showed 4,500 because:
 *   OB-230  (11 Oct)  +4,500 with expiry 2026-10-04
 *   GT-TRF-2026-8513 (9 Oct)  -4,500 with no expiry
 * Goods groups by expiry and hides qty <= 0, so it showed the opening lot
 * and hid the transfer. Item details (no lot split) correctly showed 0.
 *
 * 20261006124500 already nulled expiries; OB-230 was posted afterwards.
 * This run clears any dates that have come back.
 */

async function isBaseTable(sequelize, table) {
  const [rows] = await sequelize.query(
    `SELECT 1 AS ok
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = :table
        AND table_type = 'BASE TABLE'
      LIMIT 1`,
    { replacements: { table } },
  );
  return Boolean(rows && rows.length);
}

async function columnExists(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 AS ok
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = :table
        AND column_name = :column
      LIMIT 1`,
    { replacements: { table, column } },
  );
  return Boolean(rows && rows.length);
}

async function nullExpiry(sequelize, table, column = "expiry_date") {
  if (!(await isBaseTable(sequelize, table))) return;
  if (!(await columnExists(sequelize, table, column))) return;
  try {
    await sequelize.query(
      `UPDATE \`${table}\` SET \`${column}\` = NULL WHERE \`${column}\` IS NOT NULL`,
    );
  } catch (err) {
    const msg = String(err?.original?.sqlMessage || err?.message || "");
    if (
      err?.original?.code === "ER_NON_UPDATABLE_TABLE" ||
      /not updatable/i.test(msg)
    ) {
      return;
    }
    throw err;
  }
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await nullExpiry(sequelize, "store_entries", "expiry_date");
    await nullExpiry(sequelize, "requisition_details", "expiry_date");
    await nullExpiry(sequelize, "goods_transfer_items", "expiry_date");
    await nullExpiry(sequelize, "finished_goods", "expiry_date");
    await nullExpiry(sequelize, "item_description", "expiry_date");
    await nullExpiry(sequelize, "branch_store_list2", "expiring_date");
  },

  async down() {},
};
