"use strict";

/**
 * Put products that are not Taxable back to no VAT.
 * Non-Taxable, Exempted, Zero Rated (and a blank status) carry no VAT.
 *
 *  1. A cost-of-sales line that had VAT moved out to Input VAT
 *     (the "Input VAT removed from COGS [sku]" row, ref COGS-VAT-<id>)
 *     gets that amount added back, and the Input VAT row is removed.
 *  2. store_entries.vat_amount is set to 0 on their stock lines.
 *
 * Taxable products are not touched. Their cost of sales stays at the cost
 * after tax, for example 45,000 with VAT inside is 41,860.47 of cost and
 * 3,139.53 of Input VAT.
 *
 * The rows it changes are copied first into bak_vat_reversal_general_ledger
 * and bak_vat_reversal_store_entries. Safe to run again: once the Input VAT
 * row is gone there is nothing left to reverse.
 * Runs before the Bakers Pride cost migration (20261008224000) so that
 * line's cost of sales is back at the full cost before it is repriced.
 */

const NOT_TAXABLE = `(p.taxable IS NULL OR p.taxable <> 'Taxable')`;

const eq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const COGS_WITH_VAT_ROW = `
  FROM general_ledger gl
  INNER JOIN products p
    ON p.facility_id = gl.facility_id
   AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
  INNER JOIN general_ledger done
    ON done.facility_id = gl.facility_id
   AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
   AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
  WHERE gl.transaction_description LIKE 'COGS [%'
    AND ${NOT_TAXABLE}
`;

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // Backup first. CREATE TABLE commits in MySQL, so it is outside the transaction.
    await sequelize.query(
      "CREATE TABLE IF NOT EXISTS `bak_vat_reversal_general_ledger` LIKE `general_ledger`",
    );
    await sequelize.query(
      `INSERT IGNORE INTO bak_vat_reversal_general_ledger
       SELECT gl.* ${COGS_WITH_VAT_ROW}
       UNION
       SELECT done.* ${COGS_WITH_VAT_ROW}`,
    );

    const hasVat = await queryInterface
      .describeTable("store_entries")
      .then((d) => Boolean(d.vat_amount))
      .catch(() => false);
    if (hasVat) {
      await sequelize.query(
        "CREATE TABLE IF NOT EXISTS `bak_vat_reversal_store_entries` LIKE `store_entries`",
      );
      await sequelize.query(
        `INSERT IGNORE INTO bak_vat_reversal_store_entries
         SELECT se.* FROM store_entries se
         INNER JOIN products p
           ON ${eq("p.sku", "se.product_id")} AND ${eq("p.facility_id", "se.facilityId")}
         WHERE ${NOT_TAXABLE} AND COALESCE(se.vat_amount, 0) <> 0`,
      );
    }

    const transaction = await sequelize.transaction();
    try {
      // 1. Add the VAT back to the cost of sales line.
      await sequelize.query(
        `UPDATE general_ledger gl
         INNER JOIN products p
           ON p.facility_id = gl.facility_id
          AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
         INNER JOIN general_ledger done
           ON done.facility_id = gl.facility_id
          AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
          AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
         SET gl.dr = ROUND(gl.dr + done.dr, 2)
         WHERE gl.transaction_description LIKE 'COGS [%'
           AND ${NOT_TAXABLE}`,
        { transaction },
      );

      // 2. Remove the Input VAT rows that were created for them.
      await sequelize.query(
        `DELETE done
         FROM general_ledger done
         INNER JOIN general_ledger gl
           ON gl.facility_id = done.facility_id
          AND done.transaction_ref = CONCAT('COGS-VAT-', gl.transaction_id)
          AND done.transaction_description = CONCAT('Input VAT removed from ', gl.transaction_description)
         INNER JOIN products p
           ON p.facility_id = gl.facility_id
          AND gl.transaction_description LIKE CONCAT('COGS [', p.sku, '] %')
         WHERE gl.transaction_description LIKE 'COGS [%'
           AND ${NOT_TAXABLE}`,
        { transaction },
      );

      // 3. No VAT on the stock lines of products that are not Taxable.
      if (hasVat) {
        await sequelize.query(
          `UPDATE store_entries se
           INNER JOIN products p
             ON ${eq("p.sku", "se.product_id")} AND ${eq("p.facility_id", "se.facilityId")}
           SET se.vat_amount = 0
           WHERE ${NOT_TAXABLE} AND COALESCE(se.vat_amount, 0) <> 0`,
          { transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Putting the VAT back on a product that is not Taxable would be wrong.
  // The original rows are kept in the bak_vat_reversal_* tables.
  async down() {},
};
