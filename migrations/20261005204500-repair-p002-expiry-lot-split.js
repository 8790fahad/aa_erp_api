"use strict";

/**
 * Repair IRS Pasta (P002) ghost expiry lots caused by:
 * - GT-TRF-2026-0847: transfer OUT stamped Exp 2027-09-30 while source stock
 *   was on the no-expiry lot (left DAWANAU dated lot at -3500).
 * - Sales/write-offs at GIDAN KIFI posted qty_out with NULL expiry while stock
 *   sat on Exp 2027-09-30 (left a -621 no-expiry lot).
 *
 * After this migration:
 * - DAWANAU net / Avail align (~91,000 on no-expiry).
 * - GIDAN KIFI Goods Balance / Sale Avail align (~2,960 on Exp 2027-09-30).
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // 1) GT-TRF-2026-0847 OUT at DAWANAU (52): move off dated ghost onto no-expiry.
    await sequelize.query(`
      UPDATE store_entries
         SET expiry_date = NULL
       WHERE product_id = 'P002'
         AND branchId = 52
         AND reference_number = 'GT-TRF-2026-0847'
         AND qty_out > 0
         AND expiry_date IS NOT NULL
         AND DATE(expiry_date) = '2027-09-30'
    `);

    // 2) GIDAN KIFI (47): stamp no-expiry outs onto the dated lot that has stock.
    await sequelize.query(`
      UPDATE store_entries
         SET expiry_date = '2027-09-30'
       WHERE product_id = 'P002'
         AND branchId = 47
         AND qty_out > 0
         AND (expiry_date IS NULL
           OR expiry_date <= '2000-01-01'
           OR expiry_date = '1111-11-11')
         AND LOWER(TRIM(IFNULL(type, ''))) IN (
           'sales', 'sale', 'adjustment', 'write-off', 'write_off'
         )
    `);

    // 3) Generic safety net: if a branch has exactly one dated positive lot for
    //    P002 and a negative no-expiry lot of outs only, move those outs onto
    //    the dated lot (same pattern as the GIDAN KIFI case).
    await sequelize.query(`
      UPDATE store_entries se
      INNER JOIN (
        SELECT
          branchId,
          facilityId,
          DATE(MIN(CASE
            WHEN expiry_date IS NOT NULL
             AND expiry_date > '2000-01-01'
             AND expiry_date <> '1111-11-11'
            THEN expiry_date
          END)) AS only_dated
        FROM store_entries
        WHERE product_id = 'P002'
          AND LOWER(TRIM(IFNULL(branch_name, ''))) IN ('for sales', 'for sale')
        GROUP BY facilityId, branchId
        HAVING
          COUNT(DISTINCT CASE
            WHEN expiry_date IS NOT NULL
             AND expiry_date > '2000-01-01'
             AND expiry_date <> '1111-11-11'
            THEN DATE(expiry_date)
          END) = 1
          AND SUM(CASE
            WHEN (expiry_date IS NULL
              OR expiry_date <= '2000-01-01'
              OR expiry_date = '1111-11-11')
            THEN qty_in - qty_out ELSE 0 END) < -0.0001
          AND SUM(CASE
            WHEN expiry_date IS NOT NULL
             AND expiry_date > '2000-01-01'
             AND expiry_date <> '1111-11-11'
            THEN qty_in - qty_out ELSE 0 END) > 0.0001
      ) lot
        ON lot.branchId = se.branchId
       AND lot.facilityId = se.facilityId
       SET se.expiry_date = lot.only_dated
     WHERE se.product_id = 'P002'
       AND se.qty_out > 0
       AND (se.expiry_date IS NULL
         OR se.expiry_date <= '2000-01-01'
         OR se.expiry_date = '1111-11-11')
    `);
  },

  async down() {
    // Irreversible data repair — lot stamps were incorrect before this migration.
  },
};
