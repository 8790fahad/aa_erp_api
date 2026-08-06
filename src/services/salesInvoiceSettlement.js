/**
 * Canonical sales-invoice settlement from general_ledger.
 * Matches customer.js outstanding-invoice logic (A/R + bank/deposit legs).
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Local calendar date YYYY-MM-DD (avoids UTC shift from toISOString). */
function getLocalDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Rolling last 30 days inclusive: from (today − 30) through today. */
function getDateRangeLast30Days(asOf = new Date()) {
  const toDate = getLocalDateStr(asOf);
  const from = new Date(asOf);
  from.setDate(from.getDate() - 30);
  return {
    fromDate: getLocalDateStr(from),
    toDate,
    asOfDate: toDate,
  };
}

const SALES_INVOICE_GL_SETTLEMENT_SUBQUERY = `
        SELECT
          reference_number AS invoice_ref,
          facility_id,
          GREATEST(
            SUM(
              CASE
                WHEN LOWER(type) IN ('receivable', 'recevable') THEN dr - cr
                ELSE 0
              END
            ),
            0
          ) AS ar_outstanding,
          GREATEST(
            SUM(
              CASE
                WHEN LOWER(type) IN ('bank', 'deposit') THEN dr - cr
                ELSE 0
              END
            ),
            0
          ) AS cash_settled,
          CASE
            WHEN SUM(
              CASE
                WHEN LOWER(type) IN ('receivable', 'recevable') THEN 1
                ELSE 0
              END
            ) > 0
            THEN 1
            ELSE 0
          END AS has_receivable_activity
        FROM general_ledger
        WHERE facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id`;

const SALES_INVOICE_AMOUNT_DUE_SQL = `
        CASE
          WHEN COALESCE(se_tot.ar_outstanding, 0) > 0.001
            THEN LEAST(COALESCE(se_tot.ar_outstanding, 0), i.amount)
          WHEN COALESCE(se_tot.has_receivable_activity, 0) = 1
            THEN 0
          ELSE GREATEST(
            i.amount - LEAST(COALESCE(se_tot.cash_settled, 0), i.amount),
            0
          )
        END`;

const SALES_INVOICE_TOTAL_PAID_SQL = `
        GREATEST(
          i.amount - (${SALES_INVOICE_AMOUNT_DUE_SQL}),
          0
        )`;

const SALES_INVOICE_STATUS_SQL = `
        CASE
          WHEN (${SALES_INVOICE_AMOUNT_DUE_SQL}) <= 0.001 THEN 'paid'
          WHEN (${SALES_INVOICE_TOTAL_PAID_SQL}) > 0.001 THEN 'partially_paid'
          ELSE 'unpaid'
        END`;

function buildEnrichedSalesInvoicesSql(dateFilter = "") {
  return `
      SELECT
        i.invoice_id,
        i.ref_number,
        i.invoice_ref,
        i.due_date,
        i.transaction_date,
        i.description,
        i.amount,
        i.created_by,
        i.facility_id,
        i.type,
        i.created_at,
        i.customerNo,
        ${SALES_INVOICE_TOTAL_PAID_SQL} AS total_paid,
        ${SALES_INVOICE_AMOUNT_DUE_SQL} AS amount_due,
        ${SALES_INVOICE_STATUS_SQL} AS status
      FROM invoices i
      LEFT JOIN (
        ${SALES_INVOICE_GL_SETTLEMENT_SUBQUERY}
      ) se_tot
        ON se_tot.invoice_ref = i.invoice_ref
        AND se_tot.facility_id = i.facility_id
      WHERE i.type = 'sales'
        AND i.facility_id = :facilityId
        ${dateFilter}
      ORDER BY i.transaction_date DESC
    `;
}

async function fetchEnrichedSalesInvoices(sequelize, facilityId, options = {}) {
  const { fromDate, toDate } = options;
  let dateFilter = "";
  const replacements = { facilityId };

  if (fromDate && toDate) {
    dateFilter =
      "AND DATE(i.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)";
    replacements.fromDate = fromDate;
    replacements.toDate = toDate;
  }

  const rows = await sequelize.query(
    buildEnrichedSalesInvoicesSql(dateFilter),
    {
      replacements,
      type: sequelize.QueryTypes.SELECT,
    },
  );

  return rows.map((inv) => ({
    ...inv,
    amount: parseFloat(inv.amount || 0),
    total_paid: parseFloat(inv.total_paid || 0),
    amount_due: parseFloat(inv.amount_due || 0),
    status: (inv.status || "unpaid").toLowerCase(),
  }));
}

function aggregateReceivableMetrics(invoices, today = new Date()) {
  let totalReceivable = 0;
  let unpaid = 0;
  let partiallyPaid = 0;
  let overdue = 0;
  let notDueYet = 0;

  const aging = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days91Plus: 0,
  };

  invoices.forEach((invoice) => {
    const amountDue = parseFloat(invoice.amount_due || 0);
    if (amountDue <= 0.001) return;

    totalReceivable += amountDue;
    const paymentStatus = (invoice.status || "unpaid").toLowerCase();

    if (paymentStatus === "unpaid") {
      unpaid += amountDue;
    } else if (
      paymentStatus === "partially_paid" ||
      paymentStatus === "partial"
    ) {
      partiallyPaid += amountDue;
    }

    const dueDate = invoice.due_date ? startOfLocalDay(invoice.due_date) : null;
    if (dueDate) {
      const daysPastDue = Math.floor(
        (startOfLocalDay(today) - dueDate) / (1000 * 60 * 60 * 24),
      );
      if (daysPastDue > 0) {
        overdue += amountDue;
      } else {
        notDueYet += amountDue;
      }

      if (daysPastDue <= 0) aging.current += amountDue;
      else if (daysPastDue <= 30) aging.days1to30 += amountDue;
      else if (daysPastDue <= 60) aging.days31to60 += amountDue;
      else if (daysPastDue <= 90) aging.days61to90 += amountDue;
      else aging.days91Plus += amountDue;
    } else {
      notDueYet += amountDue;
      aging.current += amountDue;
    }
  });

  return {
    totalReceivable,
    unpaid,
    partiallyPaid,
    overdue,
    notDueYet,
    aging,
  };
}

function sumInvoicedInPeriod(invoices) {
  return invoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
}

/** Cash/bank received against sales invoices, by GL payment date (last 30 days). */
async function sumPaymentsReceivedInPeriod(
  sequelize,
  facilityId,
  fromDate,
  toDate,
) {
  const rows = await sequelize.query(
    `
      SELECT COALESCE(SUM(gl.dr), 0) AS total_received
      FROM general_ledger gl
      INNER JOIN invoices i
        ON i.invoice_ref = gl.reference_number
        AND i.facility_id = gl.facility_id
        AND i.type = 'sales'
      WHERE gl.facility_id = :facilityId
        AND LOWER(gl.type) IN ('bank', 'deposit')
        AND gl.dr > 0
        AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: sequelize.QueryTypes.SELECT,
    },
  );
  return parseFloat(rows[0]?.total_received || 0);
}

/** @deprecated Use sumPaymentsReceivedInPeriod — kept for compatibility */
function sumCollectedInPeriod(invoices, sinceDate) {
  let collected = 0;
  invoices.forEach((invoice) => {
    const transactionDate = invoice.transaction_date
      ? startOfLocalDay(invoice.transaction_date)
      : null;
    const totalPaid = parseFloat(invoice.total_paid || 0);
    if (
      transactionDate &&
      transactionDate >= startOfLocalDay(sinceDate) &&
      totalPaid > 0
    ) {
      collected += totalPaid;
    }
  });
  return collected;
}

module.exports = {
  getLocalDateStr,
  getDateRangeLast30Days,
  startOfLocalDay,
  SALES_INVOICE_GL_SETTLEMENT_SUBQUERY,
  SALES_INVOICE_AMOUNT_DUE_SQL,
  SALES_INVOICE_TOTAL_PAID_SQL,
  SALES_INVOICE_STATUS_SQL,
  fetchEnrichedSalesInvoices,
  aggregateReceivableMetrics,
  sumInvoicedInPeriod,
  sumPaymentsReceivedInPeriod,
  sumCollectedInPeriod,
};
