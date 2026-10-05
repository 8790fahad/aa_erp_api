"use strict";

/**
 * Ready-for-sales stock is grouped by expiry_date. Sales were stored with a
 * blank expiry, so the dated lot stayed at its original qty_in and the sale
 * sat on a hidden negative line.
 *
 * Stamp each goods sale onto the earliest dated receipt for the same product
 * and branch. Leave the sale blank when that branch already has an undated
 * stock-in — those two already share a balance.
 *
 * Also rewrite inventory_valuation.quantity_on_hand from store_entries.
 * When avg_unit_cost is 0, scale total_value by the quantity change so a
 * stored value is not wiped.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const sql = queryInterface.sequelize;

    await sql.query(`
      UPDATE store_entries s
      INNER JOIN (
        SELECT se.id, lot.expiry_date AS lot_expiry
        FROM store_entries se
        INNER JOIN (
          SELECT
            product_id,
            branchId,
            facilityId,
            MIN(expiry_date) AS expiry_date
          FROM store_entries
          WHERE qty_in > 0
            AND expiry_date IS NOT NULL
            AND expiry_date > '2000-01-01'
            AND type IN (
              'opening',
              'opening_balance',
              'purchase',
              'transfer',
              'production'
            )
          GROUP BY product_id, branchId, facilityId
        ) lot
          ON lot.product_id = se.product_id
         AND lot.branchId = se.branchId
         AND lot.facilityId = se.facilityId
        WHERE se.type IN ('sales', 'pro-bono')
          AND se.qty_out > 0
          AND se.expiry_date IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM store_entries o
            WHERE o.product_id = se.product_id
              AND o.branchId = se.branchId
              AND o.facilityId = se.facilityId
              AND o.qty_in > 0
              AND o.expiry_date IS NULL
              AND o.type NOT IN ('sales', 'service', 'pro-bono')
          )
      ) picked ON picked.id = s.id
      SET s.expiry_date = picked.lot_expiry
    `);

    const valuation = await queryInterface
      .describeTable("inventory_valuation")
      .catch(() => null);
    if (!valuation || !valuation.quantity_on_hand) return;

    await sql.query(`
      UPDATE inventory_valuation iv
      INNER JOIN (
        SELECT
          product_id,
          facilityId,
          SUM(COALESCE(qty_in, 0)) - SUM(COALESCE(qty_out, 0)) AS qty
        FROM store_entries
        GROUP BY product_id, facilityId
      ) b
        ON CONVERT(b.product_id USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(iv.product_id USING utf8mb4) COLLATE utf8mb4_general_ci
       AND CONVERT(b.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(iv.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
      SET
        iv.total_value = CASE
          WHEN iv.quantity_on_hand > 0 AND IFNULL(iv.avg_unit_cost, 0) = 0
            THEN ROUND(iv.total_value * b.qty / iv.quantity_on_hand, 2)
          WHEN IFNULL(iv.avg_unit_cost, 0) > 0
            THEN ROUND(b.qty * iv.avg_unit_cost, 2)
          ELSE iv.total_value
        END,
        iv.quantity_on_hand = b.qty,
        iv.updated_at = NOW()
      WHERE ABS(iv.quantity_on_hand - b.qty) > 0.0001
    `);
  },

  down: async () => {
    // Data backfill — no safe automatic rollback.
  },
};
