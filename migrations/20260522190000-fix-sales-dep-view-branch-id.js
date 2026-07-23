"use strict";

/**
 * Fix the `sales_dep` view so that `branchId` is sourced directly from
 * `store_entries.branchId` instead of a fragile JOIN against `branches`
 * by `branch_name` (which only ever matched 'Main Branch').
 *
 * Required because:
 *   - store_entries.branchId is now NOT NULL and is populated by every
 *     purchase / receipt (see migrations 20260513* and 20260522120000).
 *   - The previous view returned NULL for branchId on every branch other
 *     than 'Main Branch', so /account/get-ready-for-sales-by-branch
 *     filtered out everything for those branches.
 *
 * Also adds `se.branchId` to the GROUP BY so the view returns one row per
 * (product, branch) combination and `balance` doesn't get summed across
 * branches.
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW \`sales_dep\` AS
      WITH latest_prices AS (
        SELECT
          se.product_id AS product_id,
          se.facilityId AS facilityId,
          se.branchId AS branchId,
          se.branch_name AS branch_name,
          se.selling_price AS selling_price,
          se.expiry_date AS expiry_date,
          ROW_NUMBER() OVER (
            PARTITION BY se.product_id, se.facilityId, se.branchId
            ORDER BY se.expiry_date DESC, se.id DESC
          ) AS rn
        FROM store_entries se
        WHERE se.branch_name = 'for sales'
      )
      SELECT
        p.sku AS sku,
        p.name AS item_name,
        CONCAT(p.category, ' (', p.unit_of_measure, ')') AS uom_category,
        p.unit_of_measure AS uom,
        p.taxable AS taxable,
        COALESCE(se.product_id, p.sku) AS product_id,
        COALESCE(se.facilityId, p.facility_id) AS facilityId,
        COALESCE(p.selling_price, lp.selling_price, 0) AS selling_price,
        se.expiry_date AS expiry_date,
        COALESCE(pm.multiplier_type) AS multiplier_type,
        se.multiplier_id AS multiplier_id,
        COALESCE(SUM(se.qty_in - se.qty_out), 0) AS balance,
        p.unit_of_measure AS unit_of_measure,
        COALESCE(se.branch_name, 'for sales') AS branch_name,
        se.branchId AS branchId
      FROM products p
      LEFT JOIN store_entries se
        ON se.product_id = p.sku
        AND se.branch_name = 'for sales'
        AND se.facilityId = p.facility_id
      LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
      LEFT JOIN latest_prices lp
        ON lp.product_id = p.sku
        AND lp.facilityId = p.facility_id
        AND lp.branchId <=> se.branchId
        AND lp.rn = 1
      WHERE p.status = 'Active'
      GROUP BY
        p.sku,
        se.product_id,
        se.multiplier_id,
        p.name,
        p.category,
        p.unit_of_measure,
        p.taxable,
        p.facility_id,
        p.selling_price,
        se.facilityId,
        se.branchId,
        lp.selling_price,
        se.expiry_date,
        pm.multiplier_type,
        se.branch_name
      ORDER BY p.name ASC, se.expiry_date ASC;
    `);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // Restore the previous (broken) definition from 20260513000000 so the
    // migration is reversible.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW \`sales_dep\` AS
      WITH latest_prices AS (
        SELECT
          se.product_id AS product_id,
          se.facilityId AS facilityId,
          se.branch_name AS branch_name,
          se.selling_price AS selling_price,
          se.expiry_date AS expiry_date,
          ROW_NUMBER() OVER (
            PARTITION BY se.product_id, se.facilityId
            ORDER BY se.expiry_date DESC, se.id DESC
          ) AS rn
        FROM store_entries se
        WHERE se.branch_name = 'for sales'
      )
      SELECT
        p.sku AS sku,
        p.name AS item_name,
        CONCAT(p.category, ' (', p.unit_of_measure, ')') AS uom_category,
        p.unit_of_measure AS uom,
        p.taxable AS taxable,
        COALESCE(se.product_id, p.sku) AS product_id,
        COALESCE(se.facilityId, p.facility_id) AS facilityId,
        COALESCE(p.selling_price, lp.selling_price, 0) AS selling_price,
        se.expiry_date AS expiry_date,
        COALESCE(pm.multiplier_type) AS multiplier_type,
        se.multiplier_id AS multiplier_id,
        COALESCE(SUM(se.qty_in - se.qty_out), 0) AS balance,
        p.unit_of_measure AS unit_of_measure,
        COALESCE(se.branch_name, 'for sales') AS branch_name,
        b.id AS branchId
      FROM products p
      LEFT JOIN store_entries se
        ON se.product_id = p.sku
        AND se.branch_name = 'for sales'
        AND se.facilityId = p.facility_id
      LEFT JOIN branches b
        ON (se.branch_name = b.branch_name AND se.facilityId = b.facilityId)
        OR (b.branch_name = 'Main Branch' AND se.branch_name = 'for sales' AND se.facilityId = b.facilityId)
      LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
      LEFT JOIN latest_prices lp
        ON lp.product_id = p.sku
        AND lp.facilityId = p.facility_id
        AND lp.rn = 1
      WHERE p.status = 'Active'
      GROUP BY
        p.sku,
        se.product_id,
        se.multiplier_id,
        p.name,
        p.category,
        p.unit_of_measure,
        p.taxable,
        p.facility_id,
        p.selling_price,
        se.facilityId,
        lp.selling_price,
        se.expiry_date,
        pm.multiplier_type,
        se.branch_name,
        b.id
      ORDER BY p.name ASC, se.expiry_date ASC;
    `);
  },
};
