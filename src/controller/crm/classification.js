"use strict";

const db = require("../../models");

const DEFAULT_SETTINGS = {
  dormant_days: 90,
  inactive_days: 180,
  lost_days: 365,
  vip_min_sales: 1000000,
  regular_days: 60,
  active_days: 30,
};

const BUILTIN_SEGMENTS = [
  {
    segment_key: "vip",
    name: "VIP",
    description: "High-value customers (VIP status)",
    filters: { crm_status: "VIP" },
  },
  {
    segment_key: "dormant",
    name: "Dormant",
    description: "No recent purchases",
    filters: { crm_status: "Dormant" },
  },
  {
    segment_key: "inactive",
    name: "Inactive",
    description: "Long-inactive customers",
    filters: { crm_status: "Inactive" },
  },
  {
    segment_key: "new",
    name: "New",
    description: "Recently acquired customers",
    filters: { crm_status: "New" },
  },
  {
    segment_key: "active",
    name: "Active",
    description: "Recently purchasing customers",
    filters: { crm_status: "Active" },
  },
];

/** Customer display name — column is `fullname` (legacy DBs may still have `Name`). */
const CUSTOMER_NAME_SQL = `COALESCE(NULLIF(TRIM(c.fullname), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.customerNo)`;

const SALES_METRICS_SUBQUERY = `
  SELECT
    i.ref_number AS customer_no,
    i.facility_id,
    COUNT(*) AS invoice_count,
    COALESCE(SUM(i.amount), 0) AS total_sales,
    MIN(i.transaction_date) AS first_purchase,
    MAX(i.transaction_date) AS last_purchase
  FROM invoices i
  WHERE i.type = 'sales'
    AND i.facility_id = :facilityId
    AND i.ref_number IS NOT NULL
    AND i.ref_number != ''
  GROUP BY i.ref_number, i.facility_id
`;

const OUTSTANDING_SUBQUERY = `
  SELECT
    i.ref_number AS customer_no,
    i.facility_id,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(se_tot.ar_outstanding, 0) > 0.001
          THEN LEAST(COALESCE(se_tot.ar_outstanding, 0), i.amount)
        WHEN COALESCE(se_tot.has_receivable_activity, 0) = 1
          THEN 0
        ELSE GREATEST(
          i.amount - LEAST(COALESCE(se_tot.cash_settled, 0), i.amount),
          0
        )
      END
    ), 0) AS outstanding,
    COALESCE(SUM(
      CASE
        WHEN i.due_date IS NOT NULL
          AND i.due_date < CURDATE()
          AND (
            CASE
              WHEN COALESCE(se_tot.ar_outstanding, 0) > 0.001
                THEN LEAST(COALESCE(se_tot.ar_outstanding, 0), i.amount)
              WHEN COALESCE(se_tot.has_receivable_activity, 0) = 1
                THEN 0
              ELSE GREATEST(
                i.amount - LEAST(COALESCE(se_tot.cash_settled, 0), i.amount),
                0
              )
            END
          ) > 0.001
        THEN (
          CASE
            WHEN COALESCE(se_tot.ar_outstanding, 0) > 0.001
              THEN LEAST(COALESCE(se_tot.ar_outstanding, 0), i.amount)
            WHEN COALESCE(se_tot.has_receivable_activity, 0) = 1
              THEN 0
            ELSE GREATEST(
              i.amount - LEAST(COALESCE(se_tot.cash_settled, 0), i.amount),
              0
            )
          END
        )
        ELSE 0
      END
    ), 0) AS overdue
  FROM invoices i
  LEFT JOIN (
    SELECT
      reference_number AS invoice_ref,
      facility_id,
      GREATEST(
        SUM(CASE WHEN LOWER(type) IN ('receivable', 'recevable') THEN dr - cr ELSE 0 END),
        0
      ) AS ar_outstanding,
      GREATEST(
        SUM(CASE WHEN LOWER(type) IN ('bank', 'deposit') THEN dr - cr ELSE 0 END),
        0
      ) AS cash_settled,
      CASE
        WHEN SUM(CASE WHEN LOWER(type) IN ('receivable', 'recevable') THEN 1 ELSE 0 END) > 0
        THEN 1 ELSE 0
      END AS has_receivable_activity
    FROM general_ledger
    WHERE facility_id = :facilityId
      AND reference_number IS NOT NULL
      AND reference_number != ''
    GROUP BY reference_number, facility_id
  ) se_tot
    ON se_tot.invoice_ref = i.invoice_ref
    AND se_tot.facility_id = i.facility_id
  WHERE i.type = 'sales'
    AND i.facility_id = :facilityId
    AND i.ref_number IS NOT NULL
    AND i.ref_number != ''
  GROUP BY i.ref_number, i.facility_id
`;

async function getOrCreateSettings(facilityId) {
  let row = await db.CrmSettings.findOne({ where: { facility_id: facilityId } });
  if (!row) {
    row = await db.CrmSettings.create({
      facility_id: facilityId,
      ...DEFAULT_SETTINGS,
    });
  }
  return row;
}

async function ensureBuiltinSegments(facilityId) {
  for (const seg of BUILTIN_SEGMENTS) {
    const existing = await db.CrmSegment.findOne({
      where: { facility_id: facilityId, segment_key: seg.segment_key },
    });
    if (!existing) {
      await db.CrmSegment.create({
        facility_id: facilityId,
        ...seg,
        is_builtin: true,
      });
    }
  }
}

function classifyCustomer(metrics, settings, createdAt) {
  const now = Date.now();
  const lastPurchase = metrics?.last_purchase
    ? new Date(metrics.last_purchase).getTime()
    : null;
  const totalSales = Number(metrics?.total_sales || 0);
  const invoiceCount = Number(metrics?.invoice_count || 0);
  const daysSinceLast = lastPurchase
    ? Math.floor((now - lastPurchase) / (1000 * 60 * 60 * 24))
    : null;
  const daysSinceCreated = createdAt
    ? Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 9999;

  if (invoiceCount === 0) {
    if (daysSinceCreated <= (settings.active_days || 30)) return "New";
    return "Inactive";
  }

  if (totalSales >= Number(settings.vip_min_sales || 0) && daysSinceLast != null && daysSinceLast <= (settings.regular_days || 60)) {
    return "VIP";
  }

  if (daysSinceLast != null && daysSinceLast >= (settings.lost_days || 365)) {
    return "Lost";
  }
  if (daysSinceLast != null && daysSinceLast >= (settings.inactive_days || 180)) {
    return "Inactive";
  }
  if (daysSinceLast != null && daysSinceLast >= (settings.dormant_days || 90)) {
    return "Dormant";
  }
  if (daysSinceLast != null && daysSinceLast <= (settings.active_days || 30)) {
    return "Active";
  }
  if (daysSinceLast != null && daysSinceLast <= (settings.regular_days || 60)) {
    return "Regular";
  }
  return "Active";
}

async function classifyFacility(facilityId) {
  const settings = await getOrCreateSettings(facilityId);
  await ensureBuiltinSegments(facilityId);

  const customers = await db.sequelize.query(
    `
      SELECT
        c.customerNo AS customer_no,
        c.createdAt AS created_at,
        m.invoice_count,
        m.total_sales,
        m.first_purchase,
        m.last_purchase
      FROM customers c
      LEFT JOIN (${SALES_METRICS_SUBQUERY}) m
        ON m.customer_no = c.customerNo AND m.facility_id = c.facilityId
      WHERE c.facilityId = :facilityId
    `,
    {
      replacements: { facilityId },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  let updated = 0;
  for (const row of customers) {
    const status = classifyCustomer(
      {
        invoice_count: row.invoice_count,
        total_sales: row.total_sales,
        last_purchase: row.last_purchase,
      },
      settings,
      row.created_at,
    );

    const [meta, created] = await db.CrmCustomerMeta.findOrCreate({
      where: {
        facility_id: facilityId,
        customer_no: row.customer_no,
      },
      defaults: {
        facility_id: facilityId,
        customer_no: row.customer_no,
        crm_status: status,
      },
    });

    if (!created && meta.crm_status !== status) {
      await meta.update({ crm_status: status });
      updated += 1;
    } else if (created) {
      updated += 1;
    } else if (meta.crm_status !== status) {
      await meta.update({ crm_status: status });
      updated += 1;
    }
  }

  return { total: customers.length, updated, settings };
}

module.exports = {
  DEFAULT_SETTINGS,
  BUILTIN_SEGMENTS,
  CUSTOMER_NAME_SQL,
  SALES_METRICS_SUBQUERY,
  OUTSTANDING_SUBQUERY,
  getOrCreateSettings,
  ensureBuiltinSegments,
  classifyCustomer,
  classifyFacility,
};
