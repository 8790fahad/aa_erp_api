const db = require("../models");

let tablesReady = false;

/**
 * Ensure draft journal tables exist (safe if migration already ran).
 */
async function ensureDraftTables() {
  if (tablesReady) return;
  await db.sequelize.query(`
    CREATE TABLE IF NOT EXISTS aa_journal_drafts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_ref VARCHAR(100) NOT NULL UNIQUE,
      reference_number VARCHAR(50) NOT NULL,
      entry_date DATE NOT NULL,
      currency VARCHAR(3) DEFAULT 'NGN',
      exchange_rate DECIMAL(18,6) DEFAULT 1,
      description TEXT NULL,
      notes TEXT NULL,
      total_debit DECIMAL(15,2) DEFAULT 0,
      total_credit DECIMAL(15,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'draft',
      facility_id VARCHAR(50) NOT NULL,
      created_by VARCHAR(100) NULL,
      updated_by VARCHAR(100) NULL,
      approved_by VARCHAR(100) NULL,
      approved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_aa_jd_facility_status (facility_id, status),
      INDEX idx_aa_jd_facility_date (facility_id, entry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.sequelize.query(`
    CREATE TABLE IF NOT EXISTS aa_journal_draft_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_ref VARCHAR(100) NOT NULL,
      facility_id VARCHAR(50) NOT NULL,
      line_number INT NOT NULL DEFAULT 1,
      account_code VARCHAR(50) NOT NULL,
      account_name VARCHAR(255) NULL,
      line_date DATE NULL,
      line_description TEXT NULL,
      debit DECIMAL(15,2) DEFAULT 0,
      credit DECIMAL(15,2) DEFAULT 0,
      number_id VARCHAR(100) NULL,
      supplier_customer_id VARCHAR(100) NULL,
      supplier_customer_name VARCHAR(255) NULL,
      supplier_customer_type VARCHAR(50) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_aa_jdl_ref_facility (transaction_ref, facility_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  tablesReady = true;
}

function mapDraftToApi(draft, lines = [], createdByName = null) {
  const lineRows = (lines || []).map((line, index) => ({
    id: line.id || index + 1,
    line_number: line.line_number || index + 1,
    account_code: line.account_code,
    account_name: line.account_name || "",
    line_date: line.line_date,
    line_description: line.line_description || "",
    description: line.line_description || "",
    debit: parseFloat(line.debit || 0).toFixed(2),
    credit: parseFloat(line.credit || 0).toFixed(2),
    number_id: line.number_id || null,
    supplier_customer_id: line.supplier_customer_id || null,
    supplier_customer_name: line.supplier_customer_name || "",
    supplier_customer_type: line.supplier_customer_type || "",
  }));

  return {
    transaction_ref: draft.transaction_ref,
    reference_number: draft.reference_number,
    entry_date: draft.entry_date,
    description: draft.notes || draft.description || "",
    notes: draft.notes || "",
    currency: draft.currency || "NGN",
    exchange_rate: draft.exchange_rate || 1,
    status: draft.status === "approved" ? "posted" : "draft",
    total_debit: parseFloat(draft.total_debit || 0).toFixed(2),
    total_credit: parseFloat(draft.total_credit || 0).toFixed(2),
    facility_id: draft.facility_id,
    created_by: createdByName || draft.created_by,
    updated_by: draft.updated_by || null,
    approved_by: draft.approved_by || null,
    approved_at: draft.approved_at || null,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
    lines: lineRows,
  };
}

module.exports = {
  ensureDraftTables,
  mapDraftToApi,
};
