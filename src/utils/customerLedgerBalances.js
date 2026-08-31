/**
 * Customer money figures are derived only from general_ledger.
 * A/R (asset): SUM(dr) − SUM(cr) on type receivable.
 * Deposit (liability): SUM(cr) − SUM(dr) on type deposit.
 * Party key: transaction_ref = customerNo or customerNo-*.
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

function roundMoney(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

async function getCustomerLedgerBalances(facilityId, customerNo) {
  const db = require("../models");
  const rows = await db.sequelize.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${AR_TYPE_SQL} THEN dr - cr ELSE 0 END), 0) AS receivables,
       COALESCE(SUM(CASE WHEN ${DEPOSIT_TYPE_SQL} THEN cr - dr ELSE 0 END), 0) AS deposit
     FROM general_ledger
     WHERE facility_id = :facilityId
       AND ${customerRefSql()}`,
    {
      replacements: { facilityId, customerNo: String(customerNo || "").trim() },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  const receivables = Math.max(0, roundMoney(rows[0]?.receivables));
  const deposit = Math.max(0, roundMoney(rows[0]?.deposit));
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
  getCustomerLedgerBalances,
  roundMoney,
};
