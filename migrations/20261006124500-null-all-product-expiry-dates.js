"use strict";

/**
 * Clear product expiry dates everywhere stock / purchases track them.
 *
 * Expired lots were hiding sellable SKUs from New Invoice (get-ready-for-sales
 * filters expiry_date < CURDATE) while Goods still showed balance. Business
 * asked to drop expiry on all entries and purchase lines.
 *
 * Only BASE TABLEs are updated — views like general_inventory / sales_dep are
 * derived and not updatable.
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
    // Skip non-updatable targets (views / derived tables) without failing deploy.
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

    // Stock movements (sales floor / warehouse lots)
    await nullExpiry(sequelize, "store_entries", "expiry_date");

    // Purchase receive lines
    await nullExpiry(sequelize, "requisition_details", "expiry_date");

    // Goods transfers between stores
    await nullExpiry(sequelize, "goods_transfer_items", "expiry_date");

    // Other product stock mirrors when present (skip views)
    await nullExpiry(sequelize, "finished_goods", "expiry_date");
    await nullExpiry(sequelize, "item_description", "expiry_date");
    await nullExpiry(sequelize, "branch_store_list2", "expiring_date");
  },

  async down() {
    // Irreversible — prior expiry values are not retained.
  },
};
