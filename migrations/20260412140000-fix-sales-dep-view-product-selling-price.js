"use strict";

/**
 * Recreates `sales_dep` view:
 * - selling_price: prefer `products.selling_price`, then latest store batch price, then 0
 * - fixes broken ORDER BY (was `... ASC`expiry_date``)
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log("Skipping sales_dep view — MySQL/MariaDB only");
      return;
    }

    await queryInterface.sequelize.query(
      "DROP VIEW IF EXISTS `sales_dep`",
    );

    const sql = `
CREATE VIEW \`sales_dep\` AS
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
  COALESCE(se.branch_name, 'for sales') AS branch_name
FROM products p
LEFT JOIN store_entries se
  ON se.product_id = p.sku
  AND se.branch_name = 'for sales'
  AND se.facilityId = p.facility_id
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
  se.branch_name
ORDER BY p.name ASC, se.expiry_date ASC
`.trim();

    await queryInterface.sequelize.query(sql);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }
    await queryInterface.sequelize.query(
      "DROP VIEW IF EXISTS `sales_dep`",
    );
  },
};
