"use strict";

/**
 * Puts every product's cost onto opening stock and onto goods already sold.
 * Bakers Pride Flour (P005) is set to 47,000 first when it is still 45,000.
 * Supplier purchase bills are left at the invoiced cost.
 * A line is skipped when the product cost is more than 25% away from the
 * cost already on that line, and when it already matches.
 * Selling price is not changed.
 * Only a Taxable product keeps 7.5% inside the cost. Non-Taxable, Exempted,
 * and Zero Rated stay at the full cost, and any VAT previously taken out of
 * them is put back. Safe to run again.
 * Copies the rows it can change into bak_product_cost_sync_<table> first.
 * down() restores those rows. The backup tables are kept.
 */
const BACKUP_PREFIX = "bak_product_cost_sync_";

const TARGET_COST = `
  CASE
    WHEN p.sku = 'P005' AND p.name LIKE 'Bakers Pride%' AND p.cost_price = 45000 THEN 47000
    ELSE p.cost_price
  END
`;

const COST_IN_RANGE = `
  se.cost_price > 0
  AND (${TARGET_COST}) > 0
  AND ABS(se.cost_price - (${TARGET_COST})) >= 0.01
  AND ABS(se.cost_price - (${TARGET_COST})) / se.cost_price <= 0.25
`;

const PRODUCT_JOIN = `
  INNER JOIN products p
    ON p.sku COLLATE utf8mb4_general_ci = se.product_id COLLATE utf8mb4_general_ci
   AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
`;

const SALES_LINES = `
  SELECT
    se.reference_number,
    se.facilityId,
    p.sku,
    SUM(se.qty_out) AS qty,
    SUM(se.qty_out * se.cost_price) AS old_amount,
    SUM(se.qty_out * (${TARGET_COST})) AS new_amount
  FROM store_entries se
  ${PRODUCT_JOIN}
  WHERE se.qty_out > 0
    AND se.type <> 'purchase'
    AND ${COST_IN_RANGE}
  GROUP BY se.reference_number, se.facilityId, p.sku, p.name, p.cost_price
`;

const OPENING_LINES = `
  SELECT
    se.reference_number,
    se.facilityId,
    SUM(se.qty_in * se.cost_price) AS old_amount,
    SUM(se.qty_in * (${TARGET_COST})) AS new_amount,
    MIN(se.cost_price) AS old_cost,
    MIN(${TARGET_COST}) AS new_cost
  FROM store_entries se
  ${PRODUCT_JOIN}
  WHERE se.qty_in > 0
    AND se.type IN ('opening', 'opening_balance')
    AND ${COST_IN_RANGE}
  GROUP BY se.reference_number, se.facilityId
  HAVING COUNT(DISTINCT se.cost_price) = 1
    AND COUNT(DISTINCT (${TARGET_COST})) = 1
`;

const BACKUPS = [
  {
    table: "products",
    select: `
      SELECT p.* FROM products p
      WHERE p.sku = 'P005' AND p.name LIKE 'Bakers Pride%' AND p.cost_price = 45000
    `,
  },
  {
    table: "store_entries",
    select: `
      SELECT se.* FROM store_entries se
      ${PRODUCT_JOIN}
      WHERE se.type <> 'purchase'
        AND ${COST_IN_RANGE}
    `,
  },
  {
    table: "general_ledger",
    select: `
      SELECT gl.* FROM general_ledger gl
      INNER JOIN (${SALES_LINES}) se
        ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
       AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
      WHERE gl.transaction_description LIKE CONCAT('COGS [', se.sku, '] %')
         OR gl.transaction_description LIKE CONCAT('Inventory reduction [', se.sku, '] %')
         OR (
           gl.transaction_ref LIKE 'COGS-VAT-%'
           AND gl.reference_number COLLATE utf8mb4_general_ci = se.reference_number COLLATE utf8mb4_general_ci
         )
      UNION
      SELECT gl.* FROM general_ledger gl
      INNER JOIN (${OPENING_LINES}) se
        ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
       AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
      WHERE gl.transaction_description LIKE 'Opening Balance%'
        AND gl.type IN ('inventory', 'opening_balance')
    `,
  },
  {
    table: "inventory_valuation",
    select: `
      SELECT iv.* FROM inventory_valuation iv
      INNER JOIN products p
        ON p.sku COLLATE utf8mb4_general_ci = iv.product_id COLLATE utf8mb4_general_ci
       AND p.facility_id COLLATE utf8mb4_general_ci = iv.facility_id COLLATE utf8mb4_general_ci
      WHERE EXISTS (
        SELECT 1 FROM store_entries se
        WHERE se.product_id COLLATE utf8mb4_general_ci = p.sku COLLATE utf8mb4_general_ci
          AND se.facilityId COLLATE utf8mb4_general_ci = p.facility_id COLLATE utf8mb4_general_ci
          AND se.type <> 'purchase'
          AND ${COST_IN_RANGE}
      )
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
    const storeDesc = await queryInterface.describeTable("store_entries").catch(() => ({}));
    const hasVat = Boolean(storeDesc.vat_amount);
    const vatSql = hasVat
      ? `,
          se.vat_amount = CASE
            WHEN p.taxable = 'Taxable' THEN ROUND(
              (CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE se.qty_out END)
              * (${TARGET_COST}) * 7.5 / 107.5
            , 2)
            ELSE 0
          END`
      : "";
    const transaction = await sequelize.transaction();
    try {
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
        UPDATE general_ledger gl
        INNER JOIN (${SALES_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.dr = ROUND(se.new_amount, 2)
        WHERE gl.transaction_description LIKE CONCAT('COGS [', se.sku, '] %')
          AND ABS(gl.dr - se.old_amount) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN general_ledger vat
          ON vat.facility_id COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
         AND vat.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
        INNER JOIN (${SALES_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET
          vat.dr = ROUND(se.new_amount - (se.new_amount / 1.075), 2),
          gl.dr = ROUND(se.new_amount, 2) - ROUND(se.new_amount - (se.new_amount / 1.075), 2)
        WHERE gl.transaction_description LIKE CONCAT('COGS [', se.sku, '] %')
          AND ABS((gl.dr + vat.dr) - se.old_amount) < 0.05
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE p.sku COLLATE utf8mb4_general_ci = se.sku COLLATE utf8mb4_general_ci
              AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
              AND p.taxable = 'Taxable'
          )
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN general_ledger vat
          ON vat.facility_id COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
         AND vat.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
         AND vat.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
        INNER JOIN (${SALES_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.dr = ROUND(se.new_amount, 2)
        WHERE gl.transaction_description LIKE CONCAT('COGS [', se.sku, '] %')
          AND ABS((gl.dr + vat.dr) - se.old_amount) < 0.05
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE p.sku COLLATE utf8mb4_general_ci = se.sku COLLATE utf8mb4_general_ci
              AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
              AND (p.taxable IS NULL OR p.taxable <> 'Taxable')
          )
        `,
        { transaction },
      );

      await sequelize.query(
        `
        DELETE vat
        FROM general_ledger vat
        INNER JOIN general_ledger gl
          ON gl.facility_id COLLATE utf8mb4_general_ci = vat.facility_id COLLATE utf8mb4_general_ci
         AND vat.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
         AND vat.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
        INNER JOIN (${SALES_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        WHERE gl.transaction_description LIKE CONCAT('COGS [', se.sku, '] %')
          AND ABS(gl.dr - se.new_amount) < 0.05
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE p.sku COLLATE utf8mb4_general_ci = se.sku COLLATE utf8mb4_general_ci
              AND p.facility_id COLLATE utf8mb4_general_ci = se.facilityId COLLATE utf8mb4_general_ci
              AND (p.taxable IS NULL OR p.taxable <> 'Taxable')
          )
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (${SALES_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET gl.cr = ROUND(se.new_amount, 2)
        WHERE gl.transaction_description LIKE CONCAT('Inventory reduction [', se.sku, '] %')
          AND ABS(gl.cr - se.old_amount) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (${OPENING_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET
          gl.dr = ROUND(se.new_amount, 2),
          gl.transaction_description = REPLACE(
            gl.transaction_description,
            CONCAT('@ ', CAST(se.old_cost AS UNSIGNED)),
            CONCAT('@ ', CAST(se.new_cost AS UNSIGNED))
          )
        WHERE gl.type = 'inventory'
          AND gl.transaction_description LIKE 'Opening Balance%@ %'
          AND ABS(gl.dr - se.old_amount) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN (${OPENING_LINES}) se
          ON se.reference_number COLLATE utf8mb4_general_ci = gl.reference_number COLLATE utf8mb4_general_ci
         AND se.facilityId COLLATE utf8mb4_general_ci = gl.facility_id COLLATE utf8mb4_general_ci
        SET
          gl.cr = ROUND(se.new_amount, 2),
          gl.transaction_description = REPLACE(
            gl.transaction_description,
            CONCAT('@ ', CAST(se.old_cost AS UNSIGNED)),
            CONCAT('@ ', CAST(se.new_cost AS UNSIGNED))
          )
        WHERE gl.type = 'opening_balance'
          AND gl.transaction_description LIKE 'Opening Balance%@ %'
          AND ABS(gl.cr - se.old_amount) < 0.05
        `,
        { transaction },
      );

      await sequelize.query(
        `
        UPDATE store_entries se
        ${PRODUCT_JOIN}
        SET se.cost_price = ${TARGET_COST}${vatSql}
        WHERE se.type <> 'purchase'
          AND ${COST_IN_RANGE}
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
          iv.avg_unit_cost = p.cost_price,
          iv.total_value = ROUND(iv.quantity_on_hand * p.cost_price, 2)
        WHERE p.cost_price > 0
          AND EXISTS (
            SELECT 1 FROM \`${BACKUP_PREFIX}store_entries\` bak
            WHERE bak.product_id COLLATE utf8mb4_general_ci = p.sku COLLATE utf8mb4_general_ci
              AND bak.facilityId COLLATE utf8mb4_general_ci = p.facility_id COLLATE utf8mb4_general_ci
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
    const bakDesc = await queryInterface
      .describeTable(`${BACKUP_PREFIX}store_entries`)
      .catch(() => ({}));
    const restoreVat = bakDesc.vat_amount ? ", se.vat_amount = bak.vat_amount" : "";
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        UPDATE general_ledger gl
        INNER JOIN \`${BACKUP_PREFIX}general_ledger\` bak
          ON bak.transaction_id = gl.transaction_id
        SET
          gl.dr = bak.dr,
          gl.cr = bak.cr,
          gl.transaction_description = bak.transaction_description
        `,
        { transaction },
      );
      await sequelize.query(
        `
        UPDATE store_entries se
        INNER JOIN \`${BACKUP_PREFIX}store_entries\` bak ON bak.id = se.id
        SET se.cost_price = bak.cost_price${restoreVat}
        `,
        { transaction },
      );
      await sequelize.query(
        `
        UPDATE products p
        INNER JOIN \`${BACKUP_PREFIX}products\` bak ON bak.id = p.id
        SET p.cost_price = bak.cost_price
        `,
        { transaction },
      );
      await sequelize.query(
        `
        UPDATE inventory_valuation iv
        INNER JOIN \`${BACKUP_PREFIX}inventory_valuation\` bak ON bak.id = iv.id
        SET
          iv.avg_unit_cost = bak.avg_unit_cost,
          iv.total_value = bak.total_value
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
