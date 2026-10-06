"use strict";

/**
 * Clear product expiry dates everywhere stock / purchases track them.
 *
 * Expired lots were hiding sellable SKUs from New Invoice (get-ready-for-sales
 * filters expiry_date < CURDATE) while Goods still showed balance. Business
 * asked to drop expiry on all entries and purchase lines.
 */
async function tableExists(sequelize, table) {
  const [rows] = await sequelize.query(
    `SELECT 1 AS ok
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = :table
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
  if (!(await tableExists(sequelize, table))) return;
  if (!(await columnExists(sequelize, table, column))) return;
  await sequelize.query(
    `UPDATE \`${table}\` SET \`${column}\` = NULL WHERE \`${column}\` IS NOT NULL`,
  );
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

    // Other product stock mirrors when present
    await nullExpiry(sequelize, "finished_goods", "expiry_date");
    await nullExpiry(sequelize, "general_inventory", "expiry_date");
    await nullExpiry(sequelize, "item_description", "expiry_date");
    await nullExpiry(sequelize, "branch_store_list2", "expiring_date");
  },

  async down() {
    // Irreversible — prior expiry values are not retained.
  },
};
