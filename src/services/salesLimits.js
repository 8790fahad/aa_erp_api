"use strict";

/**
 * Product sales target / limit helpers.
 * null / undefined / <=0 limit = unlimited.
 * When a limit is reached, further sales are blocked even if stock remains.
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

function limitChecksForProduct(product, saleDate) {
  const dayLimit = parseLimit(product?.daily_sales_limit);
  const weekLimit = parseLimit(product?.weekly_sales_limit);
  const monthLimit = parseLimit(product?.monthly_sales_limit);
  if (dayLimit == null && weekLimit == null && monthLimit == null) return [];

  const when = moment(saleDate || undefined);
  if (!when.isValid()) {
    throw new Error(
      `Invalid sale date while checking sales limits for ${product?.sku || "product"}`,
    );
  }

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
  return checks;
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
 * Batch sold qty for many SKUs in one date window.
 * @returns {Map<string, number>}
 */
async function getSoldQtyInRangeBatch({
  skus,
  facilityId,
  fromDate,
  toDate,
  transaction,
}) {
  const unique = [...new Set((skus || []).filter(Boolean).map(String))];
  const map = new Map(unique.map((s) => [s, 0]));
  if (!unique.length) return map;

  const rows = await db.sequelize.query(
    `SELECT product_id AS sku, COALESCE(SUM(qty_out), 0) AS sold
     FROM store_entries
     WHERE product_id IN (:skus)
       AND facilityId = :facilityId
       AND qty_out > 0
       AND type IN (${salesTypesSqlList()})
       AND DATE(
         CASE
           WHEN receive_date IS NOT NULL AND TRIM(receive_date) <> ''
             THEN receive_date
           ELSE createdAt
         END
       ) BETWEEN :fromDate AND :toDate
     GROUP BY product_id`,
    {
      replacements: { skus: unique, facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  for (const row of rows || []) {
    map.set(String(row.sku), parseFloat(row.sold || 0) || 0);
  }
  return map;
}

/**
 * Active limit snapshot for a product (most restrictive remaining wins).
 * Returns null when unlimited.
 */
async function getProductSalesLimitSnapshot({
  product,
  sku,
  facilityId,
  saleDate,
  transaction,
}) {
  const checks = limitChecksForProduct(product, saleDate);
  if (!checks.length) return null;

  let tightest = null;
  for (const check of checks) {
    const sold = await getSoldQtyInRange({
      sku,
      facilityId,
      fromDate: check.from,
      toDate: check.to,
      transaction,
    });
    const remaining = Math.max(0, check.limit - sold);
    const snap = {
      period: check.name,
      limit: check.limit,
      sold,
      remaining,
      from: check.from,
      to: check.to,
    };
    if (!tightest || snap.remaining < tightest.remaining) tightest = snap;
  }
  return tightest;
}

function isSalesStopped(value) {
  return value === true || value === 1 || value === "1";
}

/**
 * Attach sales_limit_* fields + remaining onto sellable rows (by product_id/sku).
 * Mutates and returns the same array.
 */
async function attachSalesLimitInfo(rows, facilityId, saleDate) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || !facilityId) return list;

  const when = moment(saleDate || undefined);
  if (!when.isValid()) return list;

  const bySku = new Map();
  for (const row of list) {
    const sku = String(row.product_id || row.sku || "");
    if (!sku) continue;
    if (!bySku.has(sku)) {
      bySku.set(sku, {
        daily_sales_limit: row.daily_sales_limit,
        weekly_sales_limit: row.weekly_sales_limit,
        monthly_sales_limit: row.monthly_sales_limit,
        sales_stopped: row.sales_stopped,
      });
    }
  }

  // Prefer product master if limits / stop flag were not joined onto the row
  const missing = [...bySku.entries()].filter(
    ([, p]) =>
      p.sales_stopped == null &&
      parseLimit(p.daily_sales_limit) == null &&
      parseLimit(p.weekly_sales_limit) == null &&
      parseLimit(p.monthly_sales_limit) == null,
  );
  const needsStopFlag = [...bySku.entries()].filter(
    ([, p]) => p.sales_stopped == null,
  );
  const skusToFetch = [
    ...new Set([
      ...missing.map(([sku]) => sku),
      ...needsStopFlag.map(([sku]) => sku),
    ]),
  ];
  if (skusToFetch.length && db.Product) {
    const products = await db.Product.findAll({
      where: {
        facility_id: facilityId,
        sku: skusToFetch,
      },
      attributes: [
        "sku",
        "daily_sales_limit",
        "weekly_sales_limit",
        "monthly_sales_limit",
        "sales_stopped",
      ],
      raw: true,
    });
    for (const p of products || []) {
      const prev = bySku.get(String(p.sku)) || {};
      bySku.set(String(p.sku), {
        daily_sales_limit: p.daily_sales_limit ?? prev.daily_sales_limit,
        weekly_sales_limit: p.weekly_sales_limit ?? prev.weekly_sales_limit,
        monthly_sales_limit: p.monthly_sales_limit ?? prev.monthly_sales_limit,
        sales_stopped: p.sales_stopped,
      });
    }
  }

  const limitedSkus = [];
  const checksBySku = new Map();
  for (const [sku, product] of bySku.entries()) {
    const checks = limitChecksForProduct(product, when);
    if (!checks.length) continue;
    limitedSkus.push(sku);
    checksBySku.set(sku, { product, checks });
  }

  const soldCache = new Map(); // key: period|from|to -> Map(sku->sold)
  async function soldFor(check, skus) {
    const key = `${check.name}|${check.from}|${check.to}`;
    if (!soldCache.has(key)) {
      soldCache.set(
        key,
        await getSoldQtyInRangeBatch({
          skus,
          facilityId,
          fromDate: check.from,
          toDate: check.to,
        }),
      );
    }
    return soldCache.get(key);
  }

  const snapBySku = new Map();
  for (const sku of limitedSkus) {
    const { checks } = checksBySku.get(sku);
    let tightest = null;
    for (const check of checks) {
      const soldMap = await soldFor(
        check,
        limitedSkus.filter((s) =>
          checksBySku.get(s).checks.some(
            (c) => c.name === check.name && c.from === check.from,
          ),
        ),
      );
      const sold = soldMap.get(sku) || 0;
      const remaining = Math.max(0, check.limit - sold);
      const snap = {
        period: check.name,
        limit: check.limit,
        sold,
        remaining,
      };
      if (!tightest || snap.remaining < tightest.remaining) tightest = snap;
    }
    snapBySku.set(sku, tightest);
  }

  for (const row of list) {
    const sku = String(row.product_id || row.sku || "");
    const product = bySku.get(sku) || {};
    row.daily_sales_limit = product.daily_sales_limit ?? row.daily_sales_limit ?? null;
    row.weekly_sales_limit =
      product.weekly_sales_limit ?? row.weekly_sales_limit ?? null;
    row.monthly_sales_limit =
      product.monthly_sales_limit ?? row.monthly_sales_limit ?? null;
    row.sales_stopped = isSalesStopped(
      product.sales_stopped ?? row.sales_stopped,
    );
    const snap = snapBySku.get(sku) || null;
    row.sales_limit_period = snap?.period || null;
    row.sales_limit = snap?.limit ?? null;
    row.sales_limit_sold = snap?.sold ?? null;
    row.sales_limit_remaining =
      snap == null ? null : Math.max(0, Number(snap.remaining) || 0);
  }

  return list;
}

/**
 * Enforce daily / weekly / monthly sales limits for one line (or aggregated qty).
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
  const label = (product?.name || sku || "product").trim();

  if (isSalesStopped(product?.sales_stopped)) {
    throw new Error(
      `Sales are stopped for ${label}. This product cannot be sold on invoices.`,
    );
  }

  const checks = limitChecksForProduct(product, saleDate);
  if (!checks.length) return;

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
  isSalesStopped,
  getSoldQtyInRange,
  getSoldQtyInRangeBatch,
  getProductSalesLimitSnapshot,
  attachSalesLimitInfo,
  assertProductSalesLimits,
};
