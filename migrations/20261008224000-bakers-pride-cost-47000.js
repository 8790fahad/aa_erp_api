"use strict";

/**
 * Bakers Pride Flour (SKU P005) unit cost 45,000 becomes 47,000.
 * Updates the product, stock on hand, sales already issued, cost of sales,
 * the matching inventory reduction, and the opening-balance pair.
 * Selling price is left as it is. Zero Rated, so no VAT is taken out.
 * Safe to run again: a line already at 47,000 is skipped.
 * Before changing anything it copies the affected rows into backup tables
 * named bak_bakers_pride_47000_<table> (products, store_entries,
 * general_ledger, inventory_valuation). These are kept, not dropped by down().
 */
const BACKUP_PREFIX = "bak_bakers_pride_47000_";

/**
 * Copies every row this migration can change into backup tables.
 * Runs before the transaction because CREATE TABLE commits in MySQL.
 * Each table copies the original's structure and primary key, and rows are
 * added with INSERT IGNORE, so running again never overwrites the first copy.
 */
const BACKUPS = [
  {
    table: "products",
    select: `
      SELECT p.* FROM products p
      WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
    `,
  },
  {
    table: "store_entries",
    select: `
      SELECT se.* FROM store_entries se
      INNER JOIN products p
        ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
       AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
      WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
        AND se.cost_price IN (45000, 47000)
    `,
  },
  {
    table: "general_ledger",
    select: `
      SELECT gl.* FROM general_ledger gl
      WHERE (
          (gl.transaction_description LIKE 'COGS [P005] %'
            OR gl.transaction_description LIKE 'Inventory reduction [P005] %')
          AND EXISTS (
            SELECT 1 FROM store_entries se
            INNER JOIN products p
              ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
             AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
            WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
              AND se.qty_out > 0
              AND se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
              AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
          )
        )
        OR (
          gl.transaction_ref = 'P005'
          AND gl.type IN ('inventory', 'opening_balance')
          AND gl.transaction_description LIKE 'Opening Balance%Bakers Pride%'
        )
    `,
  },
  {
    table: "inventory_valuation",
    select: `
      SELECT iv.* FROM inventory_valuation iv
      INNER JOIN products p
        ON p.sku COLLATE utf8mb4_general_ci = iv.product_id COLLATE utf8mb4_general_ci
       AND p.facility_id COLLATE utf8mb4_general_ci = iv.facility_id COLLATE utf8mb4_general_ci
      WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%'
    `,
  },
];

async function backupAffectedTables(sequelize) {
  for (const { table, select } of BACKUPS) {
    const backup = `${BACKUP_PREFIX}${table}`;
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS \`${backup}\` LIKE \`${table}\``,
    );
    await sequelize.query(`INSERT IGNORE INTO \`${backup}\` ${select}`);
  }
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await backupAffectedTables(sequelize);
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (
          SELECT
            se.reference_number,
            se.facilityId,
            SUM(se.qty_out) AS qty
          FROM store_entries se
          INNER JOIN products p
            ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
           AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
          WHERE p.sku = 'P005'
            AND p.name LIKE 'Bakers Pride%'
            AND se.qty_out > 0
            AND se.cost_price = 45000
          GROUP BY se.reference_number, se.facilityId
        ) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.dr = ROUND(se.qty * 47000, 2)
        WHERE gl.transaction_description LIKE 'COGS [P005] %'
          AND ABS(gl.dr - (se.qty * 45000)) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (
          SELECT
            se.reference_number,
            se.facilityId,
            SUM(se.qty_out) AS qty
          FROM store_entries se
          INNER JOIN products p
            ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
           AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
          WHERE p.sku = 'P005'
            AND p.name LIKE 'Bakers Pride%'
            AND se.qty_out > 0
            AND se.cost_price = 45000
          GROUP BY se.reference_number, se.facilityId
        ) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.cr = ROUND(se.qty * 47000, 2)
        WHERE gl.transaction_description LIKE 'Inventory reduction [P005] %'
          AND ABS(gl.cr - (se.qty * 45000)) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger
        SET
          dr = ROUND(dr / 45000 * 47000, 2),
          transaction_description = REPLACE(transaction_description, '@ 45000', '@ 47000')
        WHERE transaction_ref = 'P005'
          AND type = 'inventory'
          AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 45000'
          AND dr > 0
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger
        SET
          cr = ROUND(cr / 45000 * 47000, 2),
          transaction_description = REPLACE(transaction_description, '@ 45000', '@ 47000')
        WHERE transaction_ref = 'P005'
          AND type = 'opening_balance'
          AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 45000'
          AND cr > 0
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE store_entries se
        INNER JOIN products p
          ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
         AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
        SET se.cost_price = 47000
        WHERE p.sku = 'P005'
          AND p.name LIKE 'Bakers Pride%'
          AND se.cost_price = 45000
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE products
        SET cost_price = 47000
        WHERE sku = 'P005'
          AND name LIKE 'Bakers Pride%'
          AND cost_price = 45000
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE inventory_valuation iv
        INNER JOIN products p
          ON p.sku COLLATE utf8mb4_general_ci = iv.product_id COLLATE utf8mb4_general_ci
         AND p.facility_id COLLATE utf8mb4_general_ci = iv.facility_id COLLATE utf8mb4_general_ci
        SET
          iv.avg_unit_cost = 47000,
          iv.total_value = ROUND(iv.quantity_on_hand * 47000, 2)
        WHERE p.sku = 'P005'
          AND p.name LIKE 'Bakers Pride%'
          AND iv.quantity_on_hand > 0
          AND (
            iv.avg_unit_cost = 45000
            OR ABS(iv.total_value - (iv.quantity_on_hand * 45000)) < 1
          )
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (
          SELECT
            se.reference_number,
            se.facilityId,
            SUM(se.qty_out) AS qty
          FROM store_entries se
          INNER JOIN products p
            ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
           AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
          WHERE p.sku = 'P005'
            AND p.name LIKE 'Bakers Pride%'
            AND se.qty_out > 0
            AND se.cost_price = 47000
          GROUP BY se.reference_number, se.facilityId
        ) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.dr = ROUND(se.qty * 45000, 2)
        WHERE gl.transaction_description LIKE 'COGS [P005] %'
          AND ABS(gl.dr - (se.qty * 47000)) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (
          SELECT
            se.reference_number,
            se.facilityId,
            SUM(se.qty_out) AS qty
          FROM store_entries se
          INNER JOIN products p
            ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
           AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
          WHERE p.sku = 'P005'
            AND p.name LIKE 'Bakers Pride%'
            AND se.qty_out > 0
            AND se.cost_price = 47000
          GROUP BY se.reference_number, se.facilityId
        ) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.cr = ROUND(se.qty * 45000, 2)
        WHERE gl.transaction_description LIKE 'Inventory reduction [P005] %'
          AND ABS(gl.cr - (se.qty * 47000)) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger
        SET
          dr = ROUND(dr / 47000 * 45000, 2),
          transaction_description = REPLACE(transaction_description, '@ 47000', '@ 45000')
        WHERE transaction_ref = 'P005'
          AND type = 'inventory'
          AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 47000'
          AND dr > 0
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger
        SET
          cr = ROUND(cr / 47000 * 45000, 2),
          transaction_description = REPLACE(transaction_description, '@ 47000', '@ 45000')
        WHERE transaction_ref = 'P005'
          AND type = 'opening_balance'
          AND transaction_description LIKE 'Opening Balance%Bakers Pride%@ 47000'
          AND cr > 0
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE store_entries se
        INNER JOIN products p
          ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
         AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
        SET se.cost_price = 45000
        WHERE p.sku = 'P005'
          AND p.name LIKE 'Bakers Pride%'
          AND se.cost_price = 47000
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE products
        SET cost_price = 45000
        WHERE sku = 'P005'
          AND name LIKE 'Bakers Pride%'
          AND cost_price = 47000
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE inventory_valuation iv
        INNER JOIN products p
          ON p.sku COLLATE utf8mb4_general_ci = iv.product_id COLLATE utf8mb4_general_ci
         AND p.facility_id COLLATE utf8mb4_general_ci = iv.facility_id COLLATE utf8mb4_general_ci
        SET
          iv.avg_unit_cost = 45000,
          iv.total_value = ROUND(iv.quantity_on_hand * 45000, 2)
        WHERE p.sku = 'P005'
          AND p.name LIKE 'Bakers Pride%'
          AND iv.quantity_on_hand > 0
          AND iv.avg_unit_cost = 47000
          AND ABS(iv.total_value - (iv.quantity_on_hand * 47000)) < 1
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
