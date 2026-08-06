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

/**
 * Total sellable quantity for an SKU at a branch (or facility-wide when branchId is 0).
 * Matches /inventory/goods-transfer/list and goodsTransfers approval checks.
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

  const zoneList = SELLABLE_ZONES.map((z) => `'${z}'`).join(", ");
  const rows = await db.sequelize.query(
    `SELECT IFNULL(SUM(se.qty_in) - SUM(se.qty_out), 0) AS balance
       FROM store_entries se
      WHERE se.product_id = :sku
        AND se.facilityId = :facilityId
        AND LOWER(TRIM(se.branch_name)) IN (${zoneList})
        ${branchFilter}`,
    {
      replacements: {
        sku,
        facilityId,
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

module.exports = {
  SELLABLE_ZONES,
  getSellableQtyAtBranch,
};
