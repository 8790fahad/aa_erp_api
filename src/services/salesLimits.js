"use strict";

/**
 * Product sales target / limit helpers.
 * Limits are per warehouse (product_sales_limits). Product-level
 * daily/weekly/monthly columns remain as fallback when no warehouse
 * rows exist yet. null / <=0 = unlimited.
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

function parseBranchId(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function limitKey(sku, branchId) {
  const b = parseBranchId(branchId);
  return `${sku}|${b || 0}`;
}

function emptyLimits(sales_stopped) {
  return {
    daily_sales_limit: null,
    weekly_sales_limit: null,
    monthly_sales_limit: null,
    yearly_sales_limit: null,
    sales_stopped,
  };
}

function limitsFromWarehouseRow(row, sales_stopped) {
  const period = String(row?.period || "").toLowerCase();
  const qty = parseLimit(row?.quantity);
  const base = emptyLimits(sales_stopped);
  if (!period || qty == null) return base;
  if (period === "daily") base.daily_sales_limit = qty;
  if (period === "weekly") base.weekly_sales_limit = qty;
  if (period === "monthly") base.monthly_sales_limit = qty;
  if (period === "yearly") base.yearly_sales_limit = qty;
  return base;
}

async function loadWarehouseLimitRows({ facilityId, skus, transaction }) {
  if (!db.ProductSalesLimit || !facilityId) return [];
  const unique = [...new Set((skus || []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  try {
    return await db.ProductSalesLimit.findAll({
      where: {
        facility_id: facilityId,
        sku: unique,
      },
      raw: true,
      transaction,
    });
  } catch (err) {
    console.warn("product_sales_limits lookup skipped:", err.message);
    return [];
  }
}

async function loadWarehouseStopRows({ facilityId, skus, transaction }) {
  if (!db.ProductSalesStop || !facilityId) return [];
  const unique = [...new Set((skus || []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  try {
    return await db.ProductSalesStop.findAll({
      where: {
        facility_id: facilityId,
        sku: unique,
      },
      raw: true,
      transaction,
    });
  } catch (err) {
    console.warn("product_sales_stops lookup skipped:", err.message);
    return [];
  }
}

function isStoppedForWarehouse({ product, sku, branchId, stopRows }) {
  const skuStops = (stopRows || []).filter(
    (r) => String(r.sku) === String(sku),
  );
  if (skuStops.length) {
    const bid = parseBranchId(branchId);
    if (!bid) return false;
    return skuStops.some((r) => parseBranchId(r.branch_id) === bid);
  }
  return isSalesStopped(product?.sales_stopped);
}

function limitChecksForProduct(product, saleDate) {
  const dayLimit = parseLimit(product?.daily_sales_limit);
  const weekLimit = parseLimit(product?.weekly_sales_limit);
  const monthLimit = parseLimit(product?.monthly_sales_limit);
  const yearLimit = parseLimit(product?.yearly_sales_limit);
  if (
    dayLimit == null &&
    weekLimit == null &&
    monthLimit == null &&
    yearLimit == null
  )
    return [];

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
  if (yearLimit != null) {
    checks.push({
      name: "yearly",
      limit: yearLimit,
      from: when.clone().startOf("year").format("YYYY-MM-DD"),
      to: when.clone().endOf("year").format("YYYY-MM-DD"),
    });
  }
  return checks;
}

/**
 * Sum qty_out for sales-type store entries of a product in [fromDate, toDate].
 * When branchId is set, only that warehouse is counted.
 */
async function getSoldQtyInRange({
  sku,
  facilityId,
  fromDate,
  toDate,
  branchId,
  transaction,
}) {
  const parsedBranch = parseBranchId(branchId);
  const branchSql = parsedBranch ? " AND branchId = :branchId" : "";
  const rows = await db.sequelize.query(
    `SELECT COALESCE(SUM(qty_out), 0) AS sold
     FROM store_entries
     WHERE product_id = :sku
       AND facilityId = :facilityId
       AND qty_out > 0
       AND type IN (${salesTypesSqlList()})
       ${branchSql}
       AND DATE(
         CASE
           WHEN receive_date IS NOT NULL AND TRIM(receive_date) <> ''
             THEN receive_date
           ELSE createdAt
         END
       ) BETWEEN :fromDate AND :toDate`,
    {
      replacements: {
        sku,
        facilityId,
        fromDate,
        toDate,
        ...(parsedBranch ? { branchId: parsedBranch } : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return parseFloat(rows?.[0]?.sold || 0) || 0;
}

/**
 * Batch sold qty for many SKUs in one date window.
 * @returns {{ bySku: Map<string, number>, bySkuBranch: Map<string, number> }}
 */
async function getSoldQtyInRangeBatch({
  skus,
  facilityId,
  fromDate,
  toDate,
  transaction,
}) {
  const unique = [...new Set((skus || []).filter(Boolean).map(String))];
  const bySku = new Map(unique.map((s) => [s, 0]));
  const bySkuBranch = new Map();
  if (!unique.length) return { bySku, bySkuBranch };

  const rows = await db.sequelize.query(
    `SELECT product_id AS sku, branchId, COALESCE(SUM(qty_out), 0) AS sold
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
     GROUP BY product_id, branchId`,
    {
      replacements: { skus: unique, facilityId, fromDate, toDate },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  for (const row of rows || []) {
    const sku = String(row.sku);
    const sold = parseFloat(row.sold || 0) || 0;
    bySku.set(sku, (bySku.get(sku) || 0) + sold);
    bySkuBranch.set(limitKey(sku, row.branchId), sold);
  }
  return { bySku, bySkuBranch };
}

function resolveLimitProduct({
  product,
  sku,
  branchId,
  warehouseRows,
}) {
  const rows = warehouseRows || [];
  const skuRows = rows.filter((r) => String(r.sku) === String(sku));
  if (!skuRows.length) return product;
  const match = skuRows.find(
    (r) => parseBranchId(r.branch_id) === parseBranchId(branchId),
  );
  if (!match) return emptyLimits(product?.sales_stopped);
  return limitsFromWarehouseRow(match, product?.sales_stopped);
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
  branchId,
  transaction,
}) {
  const warehouseRows = await loadWarehouseLimitRows({
    facilityId,
    skus: [sku],
    transaction,
  });
  const limitProduct = resolveLimitProduct({
    product,
    sku,
    branchId,
    warehouseRows,
  });
  const checks = limitChecksForProduct(limitProduct, saleDate);
  if (!checks.length) return null;

  const countByBranch = warehouseRows.some(
    (r) => String(r.sku) === String(sku),
  );
  const soldBranchId = countByBranch ? parseBranchId(branchId) : null;

  let tightest = null;
  for (const check of checks) {
    const sold = await getSoldQtyInRange({
      sku,
      facilityId,
      fromDate: check.from,
      toDate: check.to,
      branchId: soldBranchId,
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
  if (value == null || value === false || value === 0 || value === "0") {
    return false;
  }
  if (value === true || value === 1 || value === "1") return true;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] !== 0;
  }
  const s = String(value).toLowerCase().trim();
  return s === "true" || s === "yes" || s === "on";
}

/**
 * Attach sales_limit_* fields + remaining onto sellable rows (by product_id/sku + warehouse).
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
        yearly_sales_limit: row.yearly_sales_limit,
        sales_stopped: row.sales_stopped,
      });
    }
  }

  const missing = [...bySku.entries()].filter(
    ([, p]) =>
      p.sales_stopped == null &&
      parseLimit(p.daily_sales_limit) == null &&
      parseLimit(p.weekly_sales_limit) == null &&
      parseLimit(p.monthly_sales_limit) == null &&
      parseLimit(p.yearly_sales_limit) == null,
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
        yearly_sales_limit: prev.yearly_sales_limit,
        sales_stopped: p.sales_stopped,
      });
    }
  }

  const allSkus = [...bySku.keys()];
  const [warehouseRows, stopRows] = await Promise.all([
    loadWarehouseLimitRows({
      facilityId,
      skus: allSkus,
    }),
    loadWarehouseStopRows({
      facilityId,
      skus: allSkus,
    }),
  ]);
  const warehouseBySku = new Map();
  for (const row of warehouseRows) {
    const sku = String(row.sku);
    if (!warehouseBySku.has(sku)) warehouseBySku.set(sku, []);
    warehouseBySku.get(sku).push(row);
  }

  const limitedKeys = [];
  const checksByKey = new Map();
  for (const row of list) {
    const sku = String(row.product_id || row.sku || "");
    if (!sku) continue;
    const branchId = row.branchId ?? row.branch_id;
    const key = limitKey(sku, branchId);
    if (checksByKey.has(key)) continue;
    const product = resolveLimitProduct({
      product: bySku.get(sku) || {},
      sku,
      branchId,
      warehouseRows,
    });
    const checks = limitChecksForProduct(product, when);
    if (!checks.length) continue;
    limitedKeys.push(key);
    checksByKey.set(key, {
      sku,
      branchId: parseBranchId(branchId),
      product,
      checks,
      countByBranch: (warehouseBySku.get(sku) || []).length > 0,
    });
  }

  const soldCache = new Map();
  async function soldFor(check, skus) {
    const cacheKey = `${check.name}|${check.from}|${check.to}`;
    if (!soldCache.has(cacheKey)) {
      soldCache.set(
        cacheKey,
        await getSoldQtyInRangeBatch({
          skus,
          facilityId,
          fromDate: check.from,
          toDate: check.to,
        }),
      );
    }
    return soldCache.get(cacheKey);
  }

  const snapByKey = new Map();
  const limitedSkus = [
    ...new Set([...checksByKey.values()].map((v) => v.sku)),
  ];
  for (const key of limitedKeys) {
    const { sku, branchId, checks, countByBranch } = checksByKey.get(key);
    let tightest = null;
    for (const check of checks) {
      const maps = await soldFor(check, limitedSkus);
      const sold = countByBranch
        ? maps.bySkuBranch.get(limitKey(sku, branchId)) || 0
        : maps.bySku.get(sku) || 0;
      const remaining = Math.max(0, check.limit - sold);
      const snap = {
        period: check.name,
        limit: check.limit,
        sold,
        remaining,
      };
      if (!tightest || snap.remaining < tightest.remaining) tightest = snap;
    }
    snapByKey.set(key, tightest);
  }

  for (const row of list) {
    const sku = String(row.product_id || row.sku || "");
    const branchId = row.branchId ?? row.branch_id;
    const product = resolveLimitProduct({
      product: bySku.get(sku) || {},
      sku,
      branchId,
      warehouseRows,
    });
    row.daily_sales_limit = product.daily_sales_limit ?? null;
    row.weekly_sales_limit = product.weekly_sales_limit ?? null;
    row.monthly_sales_limit = product.monthly_sales_limit ?? null;
    row.yearly_sales_limit = product.yearly_sales_limit ?? null;
    row.sales_stopped = isStoppedForWarehouse({
      product: {
        ...product,
        sales_stopped: product.sales_stopped ?? row.sales_stopped,
      },
      sku,
      branchId,
      stopRows,
    });
    const snap = snapByKey.get(limitKey(sku, branchId)) || null;
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
  branchId,
}) {
  const label = (product?.name || sku || "product").trim();

  const [warehouseRows, stopRows] = await Promise.all([
    loadWarehouseLimitRows({
      facilityId,
      skus: [sku],
      transaction,
    }),
    loadWarehouseStopRows({
      facilityId,
      skus: [sku],
      transaction,
    }),
  ]);

  if (
    isStoppedForWarehouse({
      product,
      sku,
      branchId,
      stopRows,
    })
  ) {
    throw new Error(
      `Sales are stopped for ${label} at this warehouse. This product cannot be sold on invoices.`,
    );
  }
  const limitProduct = resolveLimitProduct({
    product,
    sku,
    branchId,
    warehouseRows,
  });
  const checks = limitChecksForProduct(limitProduct, saleDate);
  if (!checks.length) return;

  const countByBranch = warehouseRows.some(
    (r) => String(r.sku) === String(sku),
  );
  const soldBranchId = countByBranch ? parseBranchId(branchId) : null;

  for (const check of checks) {
    const sold = await getSoldQtyInRange({
      sku,
      facilityId,
      fromDate: check.from,
      toDate: check.to,
      branchId: soldBranchId,
      transaction,
    });
    const remaining = check.limit - sold;
    if (qty > remaining) {
      throw new Error(
        `Sales ${check.name} limit reached for ${label}` +
          (soldBranchId ? " at this warehouse" : "") +
          `. Limit: ${check.limit}, already sold: ${sold}, remaining: ${Math.max(0, remaining)}, requested: ${qty}`,
      );
    }
  }
}

function omitStoppedUnlessIncluded(rows, includeStopped) {
  if (includeStopped) return rows || [];
  return (rows || []).filter((r) => !isSalesStopped(r.sales_stopped));
}

module.exports = {
  parseLimit,
  isSalesStopped,
  getSoldQtyInRange,
  getSoldQtyInRangeBatch,
  getProductSalesLimitSnapshot,
  attachSalesLimitInfo,
  assertProductSalesLimits,
  loadWarehouseLimitRows,
  loadWarehouseStopRows,
  omitStoppedUnlessIncluded,
};
