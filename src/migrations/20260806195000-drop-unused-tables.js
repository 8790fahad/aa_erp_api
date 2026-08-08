"use strict";

/**
 * Drop unused / orphan tables that the live API does not read or write.
 * Idempotent — safe if tables were already removed by earlier migrations
 * or never imported.
 *
 * KEEP: logs, activity_audits, row_change_logs, purchase_*, reporting views,
 * branch_store_list2/3, transaction_data_items, Teams, asset_maintenance, etc.
 */

const UNUSED_TABLES = [
  // Prior unused set (re-drop if re-imported from old dump)
  "dala_customer_entries_backup",
  "dala_general_ledger_backup",
  "dala_invoice_backup",
  "dala_store_entries_backup",
  "dala_supplier_entries_backup",
  "general_ledger_backup",
  "production_records_backup",
  "store_entries_backup_rm0064",
  "account_1",
  "account_category3",
  "account_new",
  "inventria_account_",
  "asset_maintenances",
  "bank_details",
  "branch_requisition_status",
  "contacts",
  "daily_register",
  "debt_view",
  "estimate_items",
  "markups",
  "monthly_register",
  "newstore",
  "payment_voucher",
  "point_sale_table2",
  "production_expenses",
  "transfers",
  "manufacturing_details",
  "manufacturing_requisition",

  // Additional orphans (no live controller/service use)
  "branch_store",
  "branch_store_list",
  "users_role",
  "operator_entry_table",
  "expenditure_view",
  "payment_applications",
  "inv_grni",
  "raw_material_inventory",
];

async function tableExists(queryInterface, tableName) {
  const rows = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    {
      replacements: { tableName },
      type: queryInterface.sequelize.QueryTypes.SELECT,
    },
  );
  return rows.length > 0;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=0");
    const dropped = [];
    try {
      for (const table of UNUSED_TABLES) {
        if (!(await tableExists(queryInterface, table))) continue;
        const safe = String(table).replace(/`/g, "``");
        await queryInterface.sequelize.query(
          `DROP TABLE IF EXISTS \`${safe}\``,
        );
        try {
          await queryInterface.sequelize.query(
            `DROP VIEW IF EXISTS \`${safe}\``,
          );
        } catch (_) {
          /* ignore */
        }
        dropped.push(table);
        console.log(`  ✓ dropped unused: ${table}`);
      }
    } finally {
      await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS=1");
    }
    console.log(`  → dropped ${dropped.length} unused table(s)/view(s)`);
  },

  async down() {
    console.warn(
      "[20260806195000-drop-unused-tables] down(): restore from backup dump if needed",
    );
  },
};
