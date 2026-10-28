/**
 * Customer money figures are derived only from general_ledger.
 * A/R (asset): SUM(dr) − SUM(cr) on type receivable.
 * Deposit (liability): SUM(cr) − SUM(dr) on type deposit.
 *
 * Party attribution:
 * - transaction_ref = customerNo or customerNo-*
 * - OR reference_number is a sales invoice for that customer (covers VOID
 *   reversals that historically rewrote transaction_ref to VOID-…)
 */

const AR_TYPE_SQL = `LOWER(COALESCE(type, '')) IN ('receivable', 'recevable')`;
const DEPOSIT_TYPE_SQL = `LOWER(COALESCE(type, '')) = 'deposit'`;

function customerRefSql(customerParam = ":customerNo") {
  return `(
    transaction_ref = ${customerParam}
    OR transaction_ref LIKE CONCAT(${customerParam}, '-%')
  )`;
}

function customerRefJoinSql(customerExpr = "c.customerNo") {
  return `(
    gl.transaction_ref = ${customerExpr}
    OR gl.transaction_ref LIKE CONCAT(${customerExpr}, '-%')
  )`;
}

/** GL rows belonging to this customer (party ref or their sales invoices). */
function customerOwnedGlSql(customerParam = ":customerNo") {
  return `(
    ${customerRefSql(customerParam)}
    OR reference_number IN (
      SELECT i.invoice_ref
      FROM invoices i
      WHERE i.facility_id = :facilityId
        AND i.type = 'sales'
        AND i.ref_number = ${customerParam}
    )
  )`;
}

function roundMoney(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function snapReportBalance(n) {
  const v = roundMoney(n);
  return Math.abs(v) < 0.05 ? 0 : v;
}

async function getCustomerLedgerBalances(facilityId, customerNo) {
  const db = require("../models");
  const cust = String(customerNo || "").trim();
  // Indexed lookups. One OR against the invoice subquery makes MariaDB
  // read the whole ledger for a single customer.
  const rows = await db.sequelize.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ABS(ar) >= 0.05 THEN ar ELSE 0 END), 0) AS receivables,
       COALESCE(SUM(CASE WHEN ABS(dep) >= 0.05 THEN dep ELSE 0 END), 0) AS deposit
     FROM (
       SELECT
         COALESCE(reference_number, '') AS reference_number,
         SUM(CASE WHEN ${AR_TYPE_SQL} THEN dr - cr ELSE 0 END) AS ar,
         SUM(CASE WHEN ${DEPOSIT_TYPE_SQL} THEN cr - dr ELSE 0 END) AS dep
       FROM (
         SELECT reference_number, type, dr, cr
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND transaction_ref = :customerNo
         UNION ALL
         SELECT reference_number, type, dr, cr
         FROM general_ledger
         WHERE facility_id = :facilityId
           AND transaction_ref LIKE CONCAT(:customerNo, '-%')
         UNION ALL
         SELECT gl.reference_number, gl.type, gl.dr, gl.cr
         FROM invoices i
         INNER JOIN general_ledger gl
           ON gl.facility_id = i.facility_id
          AND gl.reference_number = i.invoice_ref
         WHERE i.facility_id = :facilityId
           AND i.type = 'sales'
           AND i.ref_number = :customerNo
           AND gl.transaction_ref <> :customerNo
           AND gl.transaction_ref NOT LIKE CONCAT(:customerNo, '-%')
       ) owned
       GROUP BY COALESCE(reference_number, '')
     ) by_ref`,
    {
      replacements: { facilityId, customerNo: cust },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  const receivables = Math.max(0, snapReportBalance(rows[0]?.receivables));
  const deposit = Math.max(0, snapReportBalance(rows[0]?.deposit));
  return {
    receivables,
    deposit,
    balance: receivables,
  };
}

module.exports = {
  AR_TYPE_SQL,
  DEPOSIT_TYPE_SQL,
  customerRefSql,
  customerRefJoinSql,
  customerOwnedGlSql,
  getCustomerLedgerBalances,
  roundMoney,
};
