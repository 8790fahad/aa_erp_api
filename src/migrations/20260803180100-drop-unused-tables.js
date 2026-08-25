"use strict";

/**
 * Drop unused / orphan / backup tables with no live app references and no inbound FKs.
 *
 * KEEP (not dropped here):
 * - asset_maintenance (Assets module)
 * - budget (budget SP)
 * - feedbacks (feedbacks routes)
 * - purchase_order* (still referenced by account/pharmacy/procurement)
 * - purchase_requisition, requisition_details
 * - reporting views: sales_dep, inventory_list, v_invoice_payment_status, vw_ar_ap_aging
 */

const UNUSED_TABLES = [
  // Backup / scratch
  "dala_customer_entries_backup",
  "dala_general_ledger_backup",
  "dala_invoice_backup",
  "dala_store_entries_backup",
  "dala_supplier_entries_backup",
  "general_ledger_backup",
  "production_records_backup",
  "store_entries_backup_rm0064",
  // Duplicate / legacy CoA copies
  "account_1",
  "account_category3",
  "account_new",
  "___PROTECT_AA_ERP_ACCOUNT___",
  // Empty / unused leftovers
  // NOTE: Do NOT drop Teams — used by src/controller/team.js and models/team.js
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
];

async function tableExists(queryInterface, tableName) {
  // Use information_schema so mixed-case names (e.g. Teams) are detected reliably.
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
    try {
      for (const table of UNUSED_TABLES) {
        if (await tableExists(queryInterface, table)) {
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
      "[20260803180100-drop-unused-tables] down(): restore from aa_erp_api/backups/*.sql if needed",
    );
  },
};
