'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create branches table if not exists
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`branches\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`branch_id\` varchar(100) NOT NULL,
        \`branch_name\` varchar(50) DEFAULT NULL,
        \`state\` varchar(50) DEFAULT NULL,
        \`address\` varchar(100) DEFAULT NULL,
        \`phone\` varchar(50) DEFAULT NULL,
        \`crm\` varchar(50) DEFAULT NULL,
        \`created_time\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        \`facilityId\` varchar(50) DEFAULT NULL,
        \`store_type\` varchar(100) NOT NULL,
        \`admin\` varchar(100) NOT NULL,
        \`created_by\` varchar(50) NOT NULL,
        \`admin_name\` varchar(100) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Add branchId to users table (MySQL < 8.0 has no ADD COLUMN IF NOT EXISTS)
    const usersColumns = await queryInterface.describeTable('users');
    if (!usersColumns.branchId) {
      await queryInterface.addColumn('users', 'branchId', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
      });
    }

    // 3. Add branchId to store_entries table
    const storeEntriesColumns =
      await queryInterface.describeTable('store_entries');
    if (!storeEntriesColumns.branchId) {
      await queryInterface.addColumn('store_entries', 'branchId', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
      });
    }

    // 4. Update sales_dep view to include branchId
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

  down: async (queryInterface, Sequelize) => {
    // Revert changes
    // 1. We keep the branches table (dropping it might cause data loss)
    
    // 2. Remove columns if they were added
    try {
      await queryInterface.removeColumn('users', 'branchId');
    } catch (e) { /* ignore */ }
    
    try {
      await queryInterface.removeColumn('store_entries', 'branchId');
    } catch (e) { /* ignore */ }

    // 3. Revert view to previous state (without branchId)
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
      ORDER BY p.name ASC, se.expiry_date ASC;
    `);
  }
};
