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

module.exports = {
  SELLABLE_ZONES,
  getSellableQtyAtBranch,
  listSellableBranchesForSku,
};
