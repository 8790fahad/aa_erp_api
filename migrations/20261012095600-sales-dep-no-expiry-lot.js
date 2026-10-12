"use strict";

/**
 * Stop splitting sellable stock by expiry date.
 * One sales_dep row per product + branch so Make Sale matches Goods.
 */

module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const eq = (a, b) =>
      `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;
    const col = (expr) =>
      `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW \`sales_dep\` AS
      WITH latest_prices AS (
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
        COALESCE(${col("se.product_id")}, ${col("p.sku")}) AS product_id,
        COALESCE(${col("se.facilityId")}, ${col("p.facility_id")}) AS facilityId,
        COALESCE(p.selling_price, lp.selling_price, 0) AS selling_price,
        CAST(NULL AS DATE) AS expiry_date,
        COALESCE(pm.multiplier_type) AS multiplier_type,
        se.multiplier_id AS multiplier_id,
        COALESCE(SUM(se.qty_in - se.qty_out), 0) AS balance,
        p.unit_of_measure AS unit_of_measure,
        'for sales' AS branch_name,
        se.branchId AS branchId
      FROM products p
      LEFT JOIN store_entries se
        ON ${eq("se.product_id", "p.sku")}
        AND ${eq("se.facilityId", "p.facility_id")}
        AND LOWER(TRIM(se.branch_name)) IN (
          'for sales', 'for sale', 'resalable', 'finished good'
        )
      LEFT JOIN product_multipliers pm ON se.multiplier_id = pm.id
      LEFT JOIN latest_prices lp
        ON ${eq("lp.product_id", "p.sku")}
        AND ${eq("lp.facilityId", "p.facility_id")}
        AND lp.branchId <=> se.branchId
        AND lp.rn = 1
      WHERE p.status = 'Active'
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
        pm.multiplier_type
      ORDER BY p.name ASC, se.branchId ASC
    `);
  },

  async down() {},
};
