"use strict";

/**
 * Profit and loss amounts follow the journal, not only the chart head.
 * A stock purchase or a cost-of-sales line can land on a sales account when a
 * product's inventory or cost head was set to a revenue code. Those lines must
 * not reduce turnover. A sales line posted to a stock account still counts as turnover.
 */

function stockMovementSql(gl = "gl") {
  return `LOWER(IFNULL(${gl}.type, '')) = 'inventory'`;
}

function cogsJournalSql(gl = "gl") {
  return `(LOWER(IFNULL(${gl}.type, '')) = 'expenses' AND ${gl}.transaction_description LIKE 'COGS [%')`;
}

function salesJournalSql(gl = "gl") {
  return `LOWER(IFNULL(${gl}.type, '')) = 'revenue'`;
}

/** Credits minus debits that belong in turnover. `isRevenueAccountSql` is a boolean SQL expression. */
function revenueLineSql(isRevenueAccountSql, gl = "gl") {
  return `CASE
    WHEN ${salesJournalSql(gl)} THEN ${gl}.cr - ${gl}.dr
    WHEN ${isRevenueAccountSql}
      AND NOT ${stockMovementSql(gl)}
      AND NOT ${cogsJournalSql(gl)}
      THEN ${gl}.cr - ${gl}.dr
    ELSE 0
  END`;
}

/** Debits minus credits that belong in expenses, including cost of sales posted to a sales account. */
function expenseLineSql(isExpenseAccountSql, gl = "gl") {
  return `CASE
    WHEN ${isExpenseAccountSql} THEN ${gl}.dr - ${gl}.cr
    WHEN ${cogsJournalSql(gl)} AND NOT (${isExpenseAccountSql}) THEN ${gl}.dr - ${gl}.cr
    ELSE 0
  END`;
}

/** Debits minus credits that belong in cost of sales. */
function cogsLineSql(isCogsAccountSql, gl = "gl") {
  return `CASE
    WHEN ${isCogsAccountSql} THEN ${gl}.dr - ${gl}.cr
    WHEN ${cogsJournalSql(gl)} AND NOT (${isCogsAccountSql}) THEN ${gl}.dr - ${gl}.cr
    ELSE 0
  END`;
}

/** Drop stock and misposted cost-of-sales journals from an account's own P&L balance. */
function plAccountAmountSql(gl = "gl", ac = "ac") {
  const keep = `NOT (
    ${stockMovementSql(gl)}
    OR (
      ${cogsJournalSql(gl)}
      AND UPPER(IFNULL(${ac}.account_nature, '')) = 'REVENUE'
    )
  )`;
  return {
    crNet: `COALESCE(SUM(CASE WHEN ${keep} THEN ${gl}.cr - ${gl}.dr ELSE 0 END), 0)`,
    drNet: `COALESCE(SUM(CASE WHEN ${keep} THEN ${gl}.dr - ${gl}.cr ELSE 0 END), 0)`,
  };
}

/** Sales credits sitting on a non-revenue head, and cost of sales sitting on a non-expense head. */
function misplacedPlSql(gl = "gl", ac = "ac") {
  return {
    sales: `COALESCE(SUM(CASE
      WHEN ${salesJournalSql(gl)}
        AND UPPER(IFNULL(${ac}.account_nature, '')) <> 'REVENUE'
      THEN ${gl}.cr - ${gl}.dr ELSE 0 END), 0)`,
    cogs: `COALESCE(SUM(CASE
      WHEN ${cogsJournalSql(gl)}
        AND UPPER(IFNULL(${ac}.account_nature, '')) <> 'EXPENSE'
      THEN ${gl}.dr - ${gl}.cr ELSE 0 END), 0)`,
  };
}

module.exports = {
  stockMovementSql,
  cogsJournalSql,
  revenueLineSql,
  expenseLineSql,
  cogsLineSql,
  plAccountAmountSql,
  misplacedPlSql,
};
