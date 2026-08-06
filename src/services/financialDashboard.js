const moment = require("moment");
const { QueryTypes } = require("sequelize");

const EXPENSE_COLORS = [
  "#059669",
  "#10b981",
  "#34d399",
  "#6ee7b7",
  "#a7f3d0",
  "#047857",
  "#065f46",
  "#064e3b",
];

function convertQueryDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-");
  if (parts.length === 3 && parts[0].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

function getDefaultPeriod() {
  const toDate = moment().format("YYYY-MM-DD");
  const fromDate = moment().subtract(30, "days").format("YYYY-MM-DD");
  return { fromDate, toDate };
}

function getPriorPeriod(fromDate, toDate) {
  const from = moment(fromDate, "YYYY-MM-DD");
  const to = moment(toDate, "YYYY-MM-DD");
  const days = to.diff(from, "days") + 1;
  const priorTo = from.clone().subtract(1, "day");
  const priorFrom = priorTo.clone().subtract(days - 1, "days");
  return {
    fromDate: priorFrom.format("YYYY-MM-DD"),
    toDate: priorTo.format("YYYY-MM-DD"),
  };
}

function pctChange(current, previous) {
  const cur = parseFloat(current || 0);
  const prev = parseFloat(previous || 0);
  // No prior activity → not a real % change (avoid fake +100%)
  if (prev === 0) {
    return { value: null, label: "— vs prior period" };
  }
  const value = ((cur - prev) / Math.abs(prev)) * 100;
  return {
    value,
    label: `${value > 0 ? "+" : ""}${value.toFixed(1)}%`,
  };
}

function formatExpenseLabel(name) {
  if (!name) return "Other";
  return String(name)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize CoA type: "Operating Expenses" / "operating_expenses" → operating_expenses */
function normalizeTypeSql(column) {
  return `LOWER(REPLACE(REPLACE(REPLACE(IFNULL(${column}, ''), '-', '_'), ' ', '_'), '__', '_'))`;
}

/** Match account_category.type for operating expenses. */
function isOperatingExpensesTypeSql(column = "ac.type") {
  return `${normalizeTypeSql(column)} = 'operating_expenses'`;
}

/**
 * Link GL → CoA by account_code (join key only).
 * Category uses account_nature: ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE.
 * If CoA row is missing, fall back to account code root digit
 * (4 = REVENUE, 5 = EXPENSE) which matches this CoA scheme.
 */
const COA_LEFT_JOIN = `
  LEFT JOIN account_category ac
    ON ac.code = gl.account_code
    AND ac.facility_id = gl.facility_id
`;

function isRevenueSql() {
  return `(
    UPPER(ac.account_nature) = 'REVENUE'
    OR (
      ac.code IS NULL
      AND (
        LEFT(TRIM(gl.account_code), 1) = '4'
        OR LOWER(gl.type) = 'revenue'
      )
    )
  )`;
}

function isExpenseSql() {
  return `(
    UPPER(ac.account_nature) = 'EXPENSE'
    OR (
      ac.code IS NULL
      AND (
        LEFT(TRIM(gl.account_code), 1) = '5'
        OR LOWER(gl.type) = 'expenses'
      )
    )
  )`;
}

async function fetchPeriodTotals(sequelize, facilityId, fromDate, toDate) {
  // Total Revenue / Total Expenses via account_nature (REVENUE / EXPENSE)
  const rows = await sequelize.query(
    `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN ${isRevenueSql()} THEN gl.cr - gl.dr
            ELSE 0
          END
        ), 0) AS total_revenue,
        COALESCE(SUM(
          CASE
            WHEN ${isExpenseSql()} THEN gl.dr - gl.cr
            ELSE 0
          END
        ), 0) AS total_expenses
      FROM general_ledger gl
      ${COA_LEFT_JOIN}
      WHERE gl.facility_id = :facilityId
        AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
        AND IFNULL(gl.type, '') != 'opening_balance'
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    },
  );

  const totalRevenue = parseFloat(rows[0]?.total_revenue || 0);
  const totalExpenses = parseFloat(rows[0]?.total_expenses || 0);
  return {
    totalRevenue,
    totalIncome: totalRevenue, // alias for older UI fields
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
  };
}

async function fetchCashInBank(sequelize, facilityId, asOfDate) {
  // Cash from ASSET accounts (cash/bank subcategory) or GL bank lines
  const rows = await sequelize.query(
    `
      SELECT COALESCE(SUM(gl.dr - gl.cr), 0) AS cash_balance
      FROM general_ledger gl
      ${COA_LEFT_JOIN}
      WHERE gl.facility_id = :facilityId
        AND DATE(gl.transaction_date) <= DATE(:asOfDate)
        AND IFNULL(gl.type, '') != 'opening_balance'
        AND (
          LOWER(gl.type) = 'bank'
          OR (
            UPPER(ac.account_nature) = 'ASSET'
            AND (
              ${normalizeTypeSql("ac.type")} IN (
                'cash_and_cash_equivalents',
                'current_assets'
              )
              OR LOWER(IFNULL(ac.subcategory, '')) IN (
                'bank',
                'cash',
                'cash_and_cash_equivalents'
              )
            )
          )
        )
    `,
    {
      replacements: { facilityId, asOfDate },
      type: QueryTypes.SELECT,
    },
  );

  return parseFloat(rows[0]?.cash_balance || 0);
}

function buildMonthSeries(fromDate, toDate) {
  const start = moment(fromDate, "YYYY-MM-DD").startOf("month");
  const end = moment(toDate, "YYYY-MM-DD").startOf("month");
  const months = [];
  const cursor = start.clone();
  while (cursor.isSameOrBefore(end, "month")) {
    months.push({
      monthKey: cursor.format("YYYY-MM"),
      month: cursor.format("MMM"),
      revenue: 0,
      income: 0,
      expenses: 0,
    });
    cursor.add(1, "month");
  }
  return months;
}

async function fetchProfitLossTrend(sequelize, facilityId, fromDate, toDate) {
  const rows = await sequelize.query(
    `
      SELECT
        DATE_FORMAT(gl.transaction_date, '%Y-%m') AS month_key,
        DATE_FORMAT(gl.transaction_date, '%b') AS month_label,
        COALESCE(SUM(
          CASE
            WHEN ${isRevenueSql()} THEN gl.cr - gl.dr
            ELSE 0
          END
        ), 0) AS revenue,
        COALESCE(SUM(
          CASE
            WHEN ${isExpenseSql()} THEN gl.dr - gl.cr
            ELSE 0
          END
        ), 0) AS expenses
      FROM general_ledger gl
      ${COA_LEFT_JOIN}
      WHERE gl.facility_id = :facilityId
        AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
        AND IFNULL(gl.type, '') != 'opening_balance'
      GROUP BY month_key, month_label
      ORDER BY month_key ASC
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    },
  );

  const byMonth = new Map(
    rows.map((row) => {
      const revenue = parseFloat(row.revenue || 0);
      const expenses = parseFloat(row.expenses || 0);
      return [
        row.month_key,
        {
          monthKey: row.month_key,
          month: row.month_label,
          revenue,
          income: revenue,
          expenses,
        },
      ];
    }),
  );

  // Always return every month in the selected period so the chart has a continuous series
  return buildMonthSeries(fromDate, toDate).map(
    (slot) => byMonth.get(slot.monthKey) || slot,
  );
}

/**
 * Expense Breakdown — Operating expenses.
 * Category: account_nature = EXPENSE
 * Sub-filter: type = operating_expenses / "Operating Expenses"
 */
async function fetchOperatingExpenseBreakdown(
  sequelize,
  facilityId,
  fromDate,
  toDate,
) {
  const rows = await sequelize.query(
    `
      SELECT
        COALESCE(
          NULLIF(ac.subcategory, ''),
          ac.description,
          'Other Operating Expenses'
        ) AS name,
        ac.subcategory,
        ac.type AS coa_type,
        ac.account_nature,
        COALESCE(SUM(gl.dr - gl.cr), 0) AS amount
      FROM account_category ac
      LEFT JOIN general_ledger gl
        ON gl.account_code = ac.code
        AND gl.facility_id = ac.facility_id
        AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
        AND IFNULL(gl.type, '') != 'opening_balance'
      WHERE ac.facility_id = :facilityId
        AND IFNULL(ac.is_active, 1) = 1
        AND UPPER(ac.account_nature) = 'EXPENSE'
        AND ${isOperatingExpensesTypeSql("ac.type")}
      GROUP BY name, ac.subcategory, ac.type, ac.account_nature
      HAVING amount > 0.001
      ORDER BY amount DESC
      LIMIT 10
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    },
  );

  // If no operating_expenses activity, show all EXPENSE nature by type/description
  if (rows.length === 0) {
    const allExpenses = await sequelize.query(
      `
        SELECT
          COALESCE(
            NULLIF(ac.type, ''),
            ac.description,
            'Other Expenses'
          ) AS name,
          ac.subcategory,
          ac.type AS coa_type,
          ac.account_nature,
          COALESCE(SUM(gl.dr - gl.cr), 0) AS amount
        FROM general_ledger gl
        INNER JOIN account_category ac
          ON ac.code = gl.account_code
          AND ac.facility_id = gl.facility_id
        WHERE gl.facility_id = :facilityId
          AND DATE(gl.transaction_date) BETWEEN DATE(:fromDate) AND DATE(:toDate)
          AND IFNULL(gl.type, '') != 'opening_balance'
          AND UPPER(ac.account_nature) = 'EXPENSE'
          AND IFNULL(ac.is_active, 1) = 1
        GROUP BY name, ac.subcategory, ac.type, ac.account_nature
        HAVING amount > 0.001
        ORDER BY amount DESC
        LIMIT 10
      `,
      {
        replacements: { facilityId, fromDate, toDate },
        type: QueryTypes.SELECT,
      },
    );

    return {
      source: "expense_nature",
      items: allExpenses.map((row, index) => ({
        name: formatExpenseLabel(row.name),
        subcategory: row.subcategory,
        type: row.coa_type,
        accountNature: row.account_nature || "EXPENSE",
        amount: parseFloat(row.amount || 0),
        color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
      })),
    };
  }

  return {
    source: "operating_expenses",
    items: rows.map((row, index) => ({
      name: formatExpenseLabel(row.name),
      subcategory: row.subcategory,
      type: row.coa_type,
      accountNature: row.account_nature,
      amount: parseFloat(row.amount || 0),
      color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
    })),
  };
}

/**
 * A sales invoice is "paid" once its A/R settles via GL (receivable/bank/deposit
 * legs matched by reference_number) — same rule used by salesInvoiceSettlement.js
 * so the feed's paid/sent split stays consistent with the Invoices widget.
 */
function resolveSalesInvoiceStatus(
  amount,
  arOutstanding,
  cashSettled,
  hasReceivableActivity,
) {
  let amountDue;
  if (arOutstanding > 0.001) {
    amountDue = Math.min(arOutstanding, amount);
  } else if (hasReceivableActivity) {
    amountDue = 0;
  } else {
    amountDue = Math.max(amount - Math.min(cashSettled, amount), 0);
  }
  const totalPaid = Math.max(amount - amountDue, 0);
  if (amountDue <= 0.001) return "paid";
  if (totalPaid > 0.001) return "partially_paid";
  return "unpaid";
}

async function fetchRecentActivity(sequelize, facilityId, limit = 5) {
  const rows = await sequelize.query(
    `
      SELECT
        i.invoice_id,
        i.invoice_ref,
        i.ref_number,
        i.type,
        i.amount,
        i.description,
        i.transaction_date,
        i.due_date,
        i.created_at,
        i.customerNo,
        c.fullname AS customer_name,
        c.store_name AS customer_store,
        sup.supplier_name AS supplier_name,
        COALESCE(se_tot.ar_outstanding, 0) AS ar_outstanding,
        COALESCE(se_tot.cash_settled, 0) AS cash_settled,
        COALESCE(se_tot.has_receivable_activity, 0) AS has_receivable_activity
      FROM invoices i
      LEFT JOIN customers c
        ON c.customerNo = i.customerNo AND c.facilityId = i.facility_id
      LEFT JOIN suppliersinfo sup
        ON sup.supplier_number = i.ref_number AND sup.facilityId = i.facility_id
      LEFT JOIN (
        SELECT
          reference_number AS invoice_ref,
          facility_id,
          GREATEST(SUM(CASE WHEN LOWER(type) IN ('receivable', 'recevable') THEN dr - cr ELSE 0 END), 0) AS ar_outstanding,
          GREATEST(SUM(CASE WHEN LOWER(type) IN ('bank', 'deposit') THEN dr - cr ELSE 0 END), 0) AS cash_settled,
          CASE WHEN SUM(CASE WHEN LOWER(type) IN ('receivable', 'recevable') THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END AS has_receivable_activity
        FROM general_ledger
        WHERE facility_id = :facilityId
          AND reference_number IS NOT NULL
          AND reference_number != ''
        GROUP BY reference_number, facility_id
      ) se_tot ON se_tot.invoice_ref = i.invoice_ref AND se_tot.facility_id = i.facility_id
      WHERE i.facility_id = :facilityId
      ORDER BY COALESCE(i.transaction_date, i.created_at) DESC, i.invoice_id DESC
      LIMIT :limit
    `,
    {
      replacements: { facilityId, limit },
      type: QueryTypes.SELECT,
    },
  );

  return rows.map((row) => {
    const amount = parseFloat(row.amount || 0);
    const type = String(row.type || "").toLowerCase();
    const ref = row.invoice_ref || row.ref_number || "";

    if (type === "sales") {
      const status = resolveSalesInvoiceStatus(
        amount,
        parseFloat(row.ar_outstanding || 0),
        parseFloat(row.cash_settled || 0),
        Number(row.has_receivable_activity) === 1,
      );
      const isPaid = status === "paid";
      const customerName =
        row.customer_name || row.customer_store || row.customerNo || "customer";
      return {
        id: row.invoice_id,
        date: row.transaction_date || row.created_at,
        description: isPaid
          ? `Invoice ${ref} paid by ${customerName}`
          : `Invoice ${ref} sent to ${customerName}`,
        amount,
        type,
        status,
        // "inflow" = cash actually received; "neutral" = invoice issued, still outstanding
        category: isPaid ? "inflow" : "neutral",
        isInflow: isPaid,
        invoiceRef: row.invoice_ref,
      };
    }

    if (type === "purchase") {
      const supplierName = row.supplier_name || row.ref_number || "supplier";
      return {
        id: row.invoice_id,
        date: row.transaction_date || row.created_at,
        description: `Bill from ${supplierName}`,
        amount: -Math.abs(amount),
        type,
        category: "outflow",
        isInflow: false,
        invoiceRef: row.invoice_ref,
      };
    }

    if (type === "payroll") {
      return {
        id: row.invoice_id,
        date: row.transaction_date || row.created_at,
        description: "Payroll run processed",
        amount: -Math.abs(amount),
        type,
        category: "outflow",
        isInflow: false,
        invoiceRef: row.invoice_ref,
      };
    }

    const detail = row.description || row.customerNo || "";
    return {
      id: row.invoice_id,
      date: row.transaction_date || row.created_at,
      description: ["Invoice", ref, detail].filter(Boolean).join(" · "),
      amount: -Math.abs(amount),
      type,
      category: "outflow",
      isInflow: false,
      invoiceRef: row.invoice_ref,
    };
  });
}

/**
 * Recent Production — latest manufacturing batches for facilities with
 * production enabled. `production_manufacturing_records` can hold several
 * rows per `batch_no` (edits create new rows), so we dedupe to the latest
 * row per batch via ROW_NUMBER before ranking, mirroring the Daily Batch Log
 * report. Reuses that report's `extractBatchSummary` so the raw material /
 * yield / variance figures shown here always match the full report.
 */
async function fetchRecentProduction(sequelize, facilityId, limit = 5) {
  try {
    const { extractBatchSummary } = require("../controller/productionReports");

    const rows = await sequelize.query(
      `
        SELECT
          pr.id, pr.batch_no, pr.production_date, pr.production_line,
          pr.type, pr.status, pr.notes, pr.data, pr.created_by AS creator_name
        FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY batch_no
            ORDER BY created_at DESC, id DESC
          ) AS _rn
          FROM production_manufacturing_records
          WHERE facility_id = :facilityId
            AND LOWER(COALESCE(status, '')) <> 'rejected'
        ) pr
        WHERE pr._rn = 1
        ORDER BY pr.production_date DESC, pr.id DESC
        LIMIT :limit
      `,
      {
        replacements: { facilityId, limit },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => {
      const summary = extractBatchSummary(row);
      const rawMaterial = summary.rawMaterial;

      return {
        id: summary.id,
        batchNo: summary.batchNo,
        date: summary.date,
        status: summary.status,
        rawMaterialName: rawMaterial?.name || "—",
        rawMaterialQty: rawMaterial?.qty || 0,
        rawMaterialUnit: rawMaterial?.unit || "Kg",
        actualYieldPct: summary.actualYieldPct,
        expectedYieldPct: summary.expectedYieldPct,
        variancePct: summary.variancePct,
        yieldStatus: summary.yieldStatus,
      };
    });
  } catch (err) {
    console.error(
      "[FinancialDashboard] recent production query failed:",
      err.message,
    );
    return [];
  }
}

async function fetchBankAccountBalances(sequelize, facilityId, asOfDate) {
  try {
    const rows = await sequelize.query(
      `
        SELECT
          ba.id,
          ba.account_name,
          ba.account_number,
          ba.bank_code,
          ba.head AS account_code,
          COALESCE(SUM(gl.dr - gl.cr), 0) AS balance
        FROM bank_accounts ba
        LEFT JOIN general_ledger gl
          ON (
            CAST(gl.bank_account_id AS CHAR) = CAST(ba.id AS CHAR)
            OR gl.account_code = ba.head
          )
          AND gl.facility_id = ba.facility_id
          AND DATE(gl.transaction_date) <= DATE(:asOfDate)
          AND IFNULL(gl.type, '') != 'opening_balance'
        WHERE ba.facility_id = :facilityId
          AND ba.status = 'active'
        GROUP BY ba.id, ba.account_name, ba.account_number, ba.bank_code, ba.head
        ORDER BY ba.account_name ASC
        LIMIT 6
      `,
      {
        replacements: { facilityId, asOfDate },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.account_name || "Bank Account",
      bankName: row.bank_code || "Bank",
      accountNumber: row.account_number,
      balance: parseFloat(row.balance || 0),
    }));
  } catch (err) {
    console.error(
      "[FinancialDashboard] bank balances query failed:",
      err.message,
    );
    return [];
  }
}

/**
 * Top Selling Products — from sales line items (`sales` table). The `sales`
 * table has no facility column of its own, so it is scoped indirectly via
 * `products.facility_id` (every sale references a facility-scoped product).
 * Returns two rankings (by revenue / by units) so the UI can toggle without
 * a round-trip.
 */
async function fetchTopProducts(sequelize, facilityId, fromDate, toDate) {
  const rows = await sequelize.query(
    `
      SELECT
        s.productId AS id,
        p.sku AS product_sku,
        COALESCE(p.name, s.description, 'Unnamed Product') AS product_name,
        COALESCE(SUM(s.quantity), 0) AS units,
        COALESCE(SUM(s.total), 0) AS revenue
      FROM sales s
      INNER JOIN products p ON p.id = s.productId
      WHERE p.facility_id = :facilityId
        AND s.status = 'completed'
        AND DATE(s.saleDate) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      GROUP BY s.productId, product_name, product_sku
      HAVING units > 0 OR revenue > 0.001
      ORDER BY revenue DESC
      LIMIT 50
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    },
  );

  const items = rows.map((row) => ({
    id: row.id,
    sku: row.product_sku || null,
    name: row.product_name,
    units: parseInt(row.units || 0, 10),
    revenue: parseFloat(row.revenue || 0),
  }));

  const byPrice = [...items].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const byUnit = [...items].sort((a, b) => b.units - a.units).slice(0, 5);

  return { byPrice, byUnit };
}

/**
 * Top Customers — from `sales` line items grouped by customer (the `invoices`
 * table only gets a row for the net receivable, so most historic/cash sales
 * never produced one — sales has the complete transaction history). The
 * `sales` table has no facility column of its own, so it is scoped indirectly
 * via `products.facility_id` (every sale references a facility-scoped
 * product). Orders are approximated as distinct (customer, sale date) pairs
 * since sales has no dedicated order/invoice id. Joined to `customers` only
 * for the display name. Generic "walk in customer" placeholder accounts are
 * excluded — they represent anonymous/one-off buyers, not real repeat
 * customers, so they aren't meaningful in a "top customers" ranking.
 */
async function fetchTopCustomers(sequelize, facilityId, fromDate, toDate) {
  const rows = await sequelize.query(
    `
      SELECT
        s.customerId AS id,
        COALESCE(NULLIF(c.fullname, ''), NULLIF(c.store_name, ''), s.customerId) AS customer_name,
        COUNT(DISTINCT CONCAT(s.customerId, '-', DATE(s.saleDate))) AS order_count,
        COALESCE(SUM(s.total), 0) AS revenue
      FROM sales s
      INNER JOIN products p ON p.id = s.productId
      LEFT JOIN customers c ON c.customerNo = s.customerId AND c.facilityId = p.facility_id
      WHERE p.facility_id = :facilityId
        AND s.status = 'completed'
        AND DATE(s.saleDate) BETWEEN DATE(:fromDate) AND DATE(:toDate)
      GROUP BY s.customerId, customer_name
      HAVING revenue > 0.001
        AND LOWER(customer_name) NOT LIKE '%walk in customer%'
        AND LOWER(customer_name) NOT LIKE '%walk-in customer%'
      ORDER BY revenue DESC
      LIMIT 50
    `,
    {
      replacements: { facilityId, fromDate, toDate },
      type: QueryTypes.SELECT,
    },
  );

  const items = rows.map((row) => ({
    id: row.id,
    name: row.customer_name,
    orderCount: parseInt(row.order_count || 0, 10),
    revenue: parseFloat(row.revenue || 0),
  }));

  const byPrice = [...items].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const byUnit = [...items]
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 5);

  return { byPrice, byUnit };
}

async function buildFinancialDashboardOverview(sequelize, options) {
  const { facilityId, from, to } = options;
  const defaults = getDefaultPeriod();
  const fromDate = convertQueryDate(from) || defaults.fromDate;
  const toDate = convertQueryDate(to) || defaults.toDate;
  const prior = getPriorPeriod(fromDate, toDate);

  const [
    currentTotals,
    priorTotals,
    cashInBank,
    priorCashInBank,
    profitLossTrend,
    operatingExpenseResult,
    recentActivity,
    recentProduction,
    bankAccounts,
    topProducts,
    topCustomers,
  ] = await Promise.all([
    fetchPeriodTotals(sequelize, facilityId, fromDate, toDate),
    fetchPeriodTotals(sequelize, facilityId, prior.fromDate, prior.toDate),
    fetchCashInBank(sequelize, facilityId, toDate),
    fetchCashInBank(sequelize, facilityId, prior.toDate),
    fetchProfitLossTrend(sequelize, facilityId, fromDate, toDate),
    fetchOperatingExpenseBreakdown(sequelize, facilityId, fromDate, toDate),
    fetchRecentActivity(sequelize, facilityId, 5),
    fetchRecentProduction(sequelize, facilityId, 5),
    fetchBankAccountBalances(sequelize, facilityId, toDate),
    fetchTopProducts(sequelize, facilityId, fromDate, toDate),
    fetchTopCustomers(sequelize, facilityId, fromDate, toDate),
  ]);

  const operatingExpenses = operatingExpenseResult.items || [];
  const operatingTotal = operatingExpenses.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const incomeChange = pctChange(
    currentTotals.totalRevenue,
    priorTotals.totalRevenue,
  );
  const expenseChange = pctChange(
    currentTotals.totalExpenses,
    priorTotals.totalExpenses,
  );
  const netProfitChange = pctChange(
    currentTotals.netProfit,
    priorTotals.netProfit,
  );
  const cashChange = pctChange(cashInBank, priorCashInBank);

  return {
    period: { from: fromDate, to: toDate },
    kpis: {
      totalRevenue: currentTotals.totalRevenue,
      totalIncome: currentTotals.totalRevenue,
      totalExpenses: currentTotals.totalExpenses,
      netProfit: currentTotals.netProfit,
      cashInBank,
      incomeChange: incomeChange.value,
      revenueChange: incomeChange.value,
      expenseChange: expenseChange.value,
      netProfitChange: netProfitChange.value,
      cashChange: cashChange.value,
      incomeChangeLabel: incomeChange.label,
      revenueChangeLabel: incomeChange.label,
      expenseChangeLabel: expenseChange.label,
      netProfitChangeLabel: netProfitChange.label,
      cashChangeLabel: cashChange.label,
    },
    profitLossTrend,
    operatingExpenseBreakdown: operatingExpenses,
    operatingExpensesTotal: operatingTotal,
    operatingExpenseSource: operatingExpenseResult.source,
    recentActivity,
    recentProduction,
    bankAccounts,
    topProducts,
    topCustomers,
  };
}

module.exports = {
  convertQueryDate,
  getDefaultPeriod,
  buildFinancialDashboardOverview,
};
