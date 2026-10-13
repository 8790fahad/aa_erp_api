"use strict";

/**
 * Invoice preview looks up one sale by receipt number, linked payments,
 * stock lines, and the invoice header. Those columns had no index, so each
 * preview scanned the whole table.
 */

const INDEXES = [
  {
    table: "customer_entries",
    fields: ["facilityId", "receiptNo"],
    name: "customer_entries_facility_receipt",
  },
  {
    table: "customer_entries",
    fields: ["facilityId", "link_id"],
    name: "customer_entries_facility_link",
  },
  {
    table: "general_ledger",
    fields: ["facility_id", "reference_number"],
    name: "general_ledger_facility_reference",
  },
  {
    table: "general_ledger",
    fields: ["facility_id", "transaction_ref"],
    name: "general_ledger_facility_txn_ref",
  },
  {
    table: "store_entries",
    fields: ["facilityId", "reference_number"],
    name: "store_entries_facility_reference",
  },
  {
    table: "invoices",
    fields: ["facility_id", "invoice_ref"],
    name: "invoices_facility_invoice_ref",
  },
  {
    table: "invoices",
    fields: ["facility_id", "type", "ref_number"],
    name: "invoices_facility_type_customer",
  },
];

async function indexExists(queryInterface, table, name) {
  try {
    const indexes = await queryInterface.showIndex(table);
    return (indexes || []).some((idx) => idx.name === name);
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface) {
    for (const index of INDEXES) {
      if (await indexExists(queryInterface, index.table, index.name)) continue;
      try {
        await queryInterface.addIndex(index.table, index.fields, {
          name: index.name,
        });
      } catch (err) {
        console.warn(`[invoice-preview-indexes] skipped ${index.name}:`, err.message);
      }
    }
  },

  async down(queryInterface) {
    for (const index of INDEXES) {
      try {
        await queryInterface.removeIndex(index.table, index.name);
      } catch {
        /* already gone */
      }
    }
  },
};
