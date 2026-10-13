"use strict";

const db = require("../models");

/** Store zones that count toward sellable / Make Sale stock (per branchId). */
const SELLABLE_ZONES = [
  "for sales",
  "for sale",
  "resalable",
  "finished good",
];

const skuEq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const zoneListSql = () =>
  SELLABLE_ZONES.map((z) => `'${z}'`).join(", ");

/**
 * Total sellable quantity for an SKU at a branch (or facility-wide when branchId is 0).
 * Matches sales_dep / Make Sale stock.
 */
async function getSellableQtyAtBranch({
  sku,
  facilityId,
  branchId,
  transaction,
}) {
  const parsedBranchId = parseInt(branchId, 10);
  const branchFilter =
    Number.isInteger(parsedBranchId) && parsedBranchId > 0
      ? `AND (
           se.branchId = :branchId
           OR (
             EXISTS (
               SELECT 1 FROM products p
                WHERE ${skuEq("p.sku", "se.product_id")}
                  AND ${skuEq("p.facility_id", "se.facilityId")}
                  AND p.item_type = 'By-Product'
             )
             AND (se.branchId = 0 OR se.branchId IS NULL)
           )
         )`
      : "";

  const rows = await db.sequelize.query(
    `SELECT IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0) AS balance
       FROM store_entries se
      WHERE se.product_id = :sku
        AND se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneListSql()})
        ${branchFilter}`,
    {
      replacements: {
        sku: String(sku || "").trim(),
        facilityId: String(facilityId || "").trim(),
        ...(Number.isInteger(parsedBranchId) && parsedBranchId > 0
          ? { branchId: parsedBranchId }
          : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return parseFloat(rows?.[0]?.balance || 0);
}

/**
 * Branches that hold sellable stock for an SKU (highest balance first).
 */
async function listSellableBranchesForSku({ sku, facilityId, transaction }) {
  const rows = await db.sequelize.query(
    `SELECT se.branchId AS branchId,
            IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0) AS balance,
            MAX(b.branch_name) AS branch_name
       FROM store_entries se
       LEFT JOIN branches b
         ON b.id = se.branchId
        AND (b.facilityId = se.facilityId OR b.facilityId IS NULL)
      WHERE se.product_id = :sku
        AND se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneListSql()})
        AND se.branchId IS NOT NULL
        AND se.branchId > 0
      GROUP BY se.branchId
     HAVING ABS(IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0)) > 0.0001
      ORDER BY balance DESC`,
    {
      replacements: {
        sku: String(sku || "").trim(),
        facilityId: String(facilityId || "").trim(),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );
  return (rows || []).map((r) => ({
    branchId: parseInt(r.branchId, 10) || 0,
    balance: parseFloat(r.balance || 0),
    branch_name: r.branch_name || null,
  }));
}

/**
 * Sellable stock for New Invoice, scoped to one facility.
 * Same grouping as the sales_dep view, but facilityId is applied inside the
 * price window so MySQL does not materialize every facility first.
 */
async function listReadyForSales({
  facilityId,
  allowSalesWithoutStock = false,
  search = "",
  limit,
  branchId,
}) {
  const rawQ = String(search || "")
    .trim()
    .replace(/[%_\\]/g, "");
  const parsedLimit = parseInt(limit, 10);
  const rowLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 50)
      : null;

  const eq = (a, b) =>
    `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  const col = (expr) =>
    `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;

  const searchSql = rawQ
    ? `AND (p.name LIKE :like OR p.sku LIKE :like OR se.product_id LIKE :like)`
    : "";
  const branchSql =
    branchId && String(branchId) !== "all" ? "AND se.branchId = :branchId" : "";
  const havingSql = allowSalesWithoutStock ? "" : "HAVING balance > 0";
  const limitSql = rowLimit ? `LIMIT ${rowLimit}` : "";

  return db.sequelize.query(
    `WITH latest_prices AS (
      SELECT
        se.product_id AS product_id,
        se.facilityId AS facilityId,
        se.branchId AS branchId,
        se.selling_price AS selling_price,
        ROW_NUMBER() OVER (
          PARTITION BY se.product_id, se.facilityId, se.branchId
          ORDER BY se.id DESC
        ) AS rn
      FROM store_entries se
      WHERE se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneListSql()})
    )
    SELECT
      p.sku AS sku,
      p.name AS item_name,
      CONCAT(p.category, ' (', p.unit_of_measure, ')') AS uom_category,
      p.unit_of_measure AS uom,
      p.taxable AS taxable,
      COALESCE(${col("se.product_id")}, ${col("p.sku")}) AS product_id,
      COALESCE(${col("se.facilityId")}, ${col("p.facility_id")}) AS facilityId,
      se.branchId AS branchId,
      COALESCE(p.selling_price, lp.selling_price, 0) AS selling_price,
      CAST(NULL AS DATE) AS expiry_date,
      pm.multiplier_type AS multiplier_type,
      se.multiplier_id AS multiplier_id,
      COALESCE(SUM(se.qty_in - se.qty_out), 0) AS balance,
      p.unit_of_measure AS unit_of_measure,
      'for sales' AS branch_name,
      p.daily_sales_limit,
      p.weekly_sales_limit,
      p.monthly_sales_limit,
      p.sales_stopped,
      b.branch_name AS location_name,
      CONCAT(
        COALESCE(${col("se.product_id")}, ${col("p.sku")}),
        '-NULL-',
        COALESCE(se.multiplier_id, 'NULL'),
        '-',
        COALESCE(p.selling_price, lp.selling_price, 0),
        '-',
        COALESCE(se.branchId, 0)
      ) AS id
    FROM products p
    LEFT JOIN store_entries se
      ON ${eq("se.product_id", "p.sku")}
      AND ${eq("se.facilityId", "p.facility_id")}
      AND se.facilityId = :facilityId
      AND LOWER(TRIM(se.branch_name)) IN (${zoneListSql()})
    LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
    LEFT JOIN latest_prices lp
      ON ${eq("lp.product_id", "p.sku")}
      AND ${eq("lp.facilityId", "p.facility_id")}
      AND lp.branchId <=> se.branchId
      AND lp.rn = 1
    LEFT JOIN branches b
      ON b.id = se.branchId
      AND (b.facilityId = p.facility_id OR b.facilityId IS NULL)
    WHERE p.status = 'Active'
      AND p.facility_id = :facilityId
      AND se.branchId IS NOT NULL
      AND se.branchId > 0
      ${branchSql}
      ${searchSql}
    GROUP BY
      p.sku,
      ${col("se.product_id")},
      se.multiplier_id,
      p.name,
      p.category,
      p.unit_of_measure,
      p.taxable,
      p.facility_id,
      p.selling_price,
      ${col("se.facilityId")},
      se.branchId,
      lp.selling_price,
      pm.multiplier_type,
      p.daily_sales_limit,
      p.weekly_sales_limit,
      p.monthly_sales_limit,
      p.sales_stopped,
      b.branch_name
    ${havingSql}
    ORDER BY COALESCE(b.branch_name, ''), p.name, se.branchId
    ${limitSql}`,
    {
      replacements: {
        facilityId: String(facilityId),
        ...(rawQ ? { like: `%${rawQ}%` } : {}),
        ...(branchId && String(branchId) !== "all"
          ? { branchId }
          : {}),
      },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
}

/**
 * Sellable qty for many SKUs in one query. Key is `${sku}|${branchId}`.
 */
async function getSellableQtyMap({ facilityId, skus, transaction }) {
  const unique = [...new Set((skus || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!unique.length || !facilityId) return map;

  const rows = await db.sequelize.query(
    `SELECT se.product_id AS sku,
            se.branchId AS branchId,
            IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0) AS balance
       FROM store_entries se
      WHERE se.product_id IN (:skus)
        AND se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneListSql()})
        AND se.branchId IS NOT NULL
        AND se.branchId > 0
      GROUP BY se.product_id, se.branchId`,
    {
      replacements: {
        skus: unique,
        facilityId: String(facilityId),
      },
      type: db.sequelize.QueryTypes.SELECT,
      transaction,
    },
  );

  for (const row of rows || []) {
    map.set(
      `${row.sku}|${parseInt(row.branchId, 10) || 0}`,
      parseFloat(row.balance || 0) || 0,
    );
  }
  return map;
}

module.exports = {
  SELLABLE_ZONES,
  getSellableQtyAtBranch,
  listSellableBranchesForSku,
  listReadyForSales,
  getSellableQtyMap,
};
