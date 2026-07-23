"use strict";

/**
 * Product sales target / limit helpers.
 * null / undefined / <=0 limit = unlimited.
 */

const moment = require("moment");
const db = require("../models");
const { salesTypesSqlList } = require("../constants/storeEntryTypes");

function parseLimit(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Sum qty_out for sales-type store entries of a product in [fromDate, toDate] (inclusive, YYYY-MM-DD).
 */
async function getSoldQtyInRange({
  sku,
  facilityId,
  fromDate,
  toDate,
  transaction,
}) {
  const rows = await db.sequelize.query(
    `SELECT COALESCE(SUM(qty_out), 0) AS sold
     FROM store_entries
     WHERE product_id = :sku
       AND facilityId = :facilityId
       AND qty_out > 0
       AND type IN (${salesTypesSqlList()})
       AND DATE(
         CASE
           WHEN receive_date IS NOT NULL AND TRIM(receive_date) <> ''
             THEN receive_date
           ELSE createdAt
         END
       ) BETWEEN :fromDate AND :toDate`,
    {
      replacements: { sku, facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return parseFloat(rows?.[0]?.sold || 0) || 0;
}

/**
 * Enforce daily / weekly / monthly sales limits for one line.
 * Throws Error when the requested qty would exceed a configured limit.
 */
async function assertProductSalesLimits({
  product,
  sku,
  facilityId,
  qty,
  saleDate,
  transaction,
}) {
  const dayLimit = parseLimit(product.daily_sales_limit);
  const weekLimit = parseLimit(product.weekly_sales_limit);
  const monthLimit = parseLimit(product.monthly_sales_limit);
  if (dayLimit == null && weekLimit == null && monthLimit == null) return;

  const when = moment(saleDate || undefined);
  if (!when.isValid()) {
    throw new Error(`Invalid sale date while checking sales limits for ${sku}`);
  }

  const label = (product.name || sku || "product").trim();
  const checks = [];

  if (dayLimit != null) {
    checks.push({
      name: "daily",
      limit: dayLimit,
      from: when.clone().startOf("day").format("YYYY-MM-DD"),
      to: when.clone().endOf("day").format("YYYY-MM-DD"),
    });
  }
  if (weekLimit != null) {
    checks.push({
      name: "weekly",
      limit: weekLimit,
      from: when.clone().startOf("isoWeek").format("YYYY-MM-DD"),
      to: when.clone().endOf("isoWeek").format("YYYY-MM-DD"),
    });
  }
  if (monthLimit != null) {
    checks.push({
      name: "monthly",
      limit: monthLimit,
      from: when.clone().startOf("month").format("YYYY-MM-DD"),
      to: when.clone().endOf("month").format("YYYY-MM-DD"),
    });
  }

  for (const check of checks) {
    const sold = await getSoldQtyInRange({
      sku,
      facilityId,
      fromDate: check.from,
      toDate: check.to,
      transaction,
    });
    const remaining = check.limit - sold;
    if (qty > remaining) {
      throw new Error(
        `Sales ${check.name} limit reached for ${label}. ` +
          `Limit: ${check.limit}, already sold: ${sold}, remaining: ${Math.max(0, remaining)}, requested: ${qty}`,
      );
    }
  }
}

module.exports = {
  parseLimit,
  getSoldQtyInRange,
  assertProductSalesLimits,
};
