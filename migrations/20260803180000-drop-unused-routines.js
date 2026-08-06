"use strict";

/**
 * Drop stored procedures that the app no longer CALLs (live code).
 * purchaseRequisition was replaced by runPurchaseRequisitionQuery in account.js.
 * Does NOT drop generate_account_code (still used by accountCategory.js).
 */

const UNUSED_PROCEDURES = [
  "purchaseRequisition",
  "add_branch_store",
  "add_new_supplier",
  "business_profile",
  "business_settings",
  "chart_of_acct",
  "create_business",
  "create_customer",
  "customer_deposit1",
  "deposit",
  "getBranchRequisitionList2",
  "get_all_transactions_data",
  "get_beneficiary_no",
  "get_best_selling_staff",
  "get_business_profile",
  "get_customer_details",
  "get_customer_stmt",
  "get_id",
  "get_ids",
  "get_individual_report",
  "get_items_from_branchstore3",
  "get_patient_acc_stmt",
  "get_patient_reg_breakdown_per_year",
  "get_request_list2",
  "get_supplier_acct_stmt",
  "get_users_by_fac",
  "get_user_by_id",
  "insert_branch store",
  "manufactureRequisition",
  "new_service_instant_payment",
  "new_tax_deduction",
  "pv_collection",
  "records_breakdown_by_month",
  "report_general_by_date",
  "report_general_by_date2",
  "report_suppliers",
  "return_item",
  "service_transaction2",
  "status_update",
  "store_received_item_entry",
  "supplier_account_information",
  "update_purchase_order_status",
  "update_request_status2",
  "update_status",
];

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

module.exports = {
  async up(queryInterface) {
    for (const name of UNUSED_PROCEDURES) {
      await queryInterface.sequelize.query(
        `DROP PROCEDURE IF EXISTS ${quoteIdent(name)}`,
      );
    }
  },

  async down() {
    // Routines are not recreated here; restore from DB backup if needed.
    console.warn(
      "[20260803180000-drop-unused-routines] down(): procedures were not restored",
    );
  },
};
