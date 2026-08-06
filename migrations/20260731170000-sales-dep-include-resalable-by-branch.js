"use strict";

/**
 * Expand `sales_dep` so sellable stock includes warehouse zones
 * (Resalable / Finished Good) as well as the sales floor ("for sales"),
 * still one row per (product, physical branchId).
 *
 * Previously only `branch_name = 'for sales'` was counted, so the same SKU
 * received into another branch as "Resalable" never appeared in Make Sale.
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
          se.selling_price AS selling_price,
          se.expiry_date AS expiry_date,
          ROW_NUMBER() OVER (
            PARTITION BY se.product_id, se.facilityId, se.branchId
            ORDER BY se.expiry_date DESC, se.id DESC
          ) AS rn
        FROM store_entries se
        WHERE LOWER(TRIM(se.branch_name)) IN (
          'for sales', 'for sale', 'resalable', 'finished good'
        )
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
        'for sales' AS branch_name,
        se.branchId AS branchId
      FROM products p
      LEFT JOIN store_entries se
        ON se.product_id = p.sku
        AND se.facilityId = p.facility_id
        AND LOWER(TRIM(se.branch_name)) IN (
          'for sales', 'for sale', 'resalable', 'finished good'
        )
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
        pm.multiplier_type
      ORDER BY p.name ASC, se.branchId ASC, se.expiry_date ASC;
    `);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // Restore prior definition from 20260522190000
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
};
