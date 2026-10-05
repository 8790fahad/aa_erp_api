"use strict";

/**
 * Past goods transfers often wrote store_entries without expiry_date, so the
 * destination warehouse showed the same SKU twice (dated lot + no-expiry lot).
 *
 * 1) Stamp GT transfer lines with the best dated expiry from source/destination.
 * 2) Where a branch has exactly one dated lot for a SKU, move remaining
 *    no-expiry transfer/sales/adjustment rows onto that lot so the picker
 *    shows one line.
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // Stamp null-expiry GT transfer rows from a dated lot on the same SKU
    // at either end of the transfer (prefer destination, then source).
    await sequelize.query(`
      UPDATE store_entries se
      INNER JOIN (
        SELECT
          t.reference_number,
          t.product_id,
          t.facilityId,
          COALESCE(
            (
              SELECT DATE(d.expiry_date)
              FROM store_entries d
              WHERE d.product_id = t.product_id
                AND d.facilityId = t.facilityId
                AND d.branchId = t.dest_branch
                AND d.expiry_date IS NOT NULL
                AND d.expiry_date > '2000-01-01'
                AND d.expiry_date <> '1111-11-11'
                AND LOWER(TRIM(IFNULL(d.branch_name, ''))) IN ('for sales', 'for sale')
              GROUP BY DATE(d.expiry_date)
              ORDER BY SUM(d.qty_in - d.qty_out) DESC, DATE(d.expiry_date) ASC
              LIMIT 1
            ),
            (
              SELECT DATE(s.expiry_date)
              FROM store_entries s
              WHERE s.product_id = t.product_id
                AND s.facilityId = t.facilityId
                AND s.branchId = t.src_branch
                AND s.expiry_date IS NOT NULL
                AND s.expiry_date > '2000-01-01'
                AND s.expiry_date <> '1111-11-11'
                AND LOWER(TRIM(IFNULL(s.branch_name, ''))) IN ('for sales', 'for sale')
              GROUP BY DATE(s.expiry_date)
              ORDER BY SUM(s.qty_in - s.qty_out) DESC, DATE(s.expiry_date) ASC
              LIMIT 1
            )
          ) AS target_expiry
        FROM (
          SELECT
            reference_number,
            product_id,
            facilityId,
            MAX(CASE WHEN qty_out > 0 THEN branchId END) AS src_branch,
            MAX(CASE WHEN qty_in > 0 THEN branchId END) AS dest_branch
          FROM store_entries
          WHERE type = 'transfer'
            AND (
              reference_number LIKE 'GT-%'
              OR reference_number LIKE '%TRF%'
            )
            AND (expiry_date IS NULL OR expiry_date <= '2000-01-01' OR expiry_date = '1111-11-11')
          GROUP BY reference_number, product_id, facilityId
        ) t
      ) map
        ON map.reference_number = se.reference_number
       AND map.product_id = se.product_id
       AND map.facilityId = se.facilityId
       AND map.target_expiry IS NOT NULL
      SET se.expiry_date = map.target_expiry
      WHERE se.type = 'transfer'
        AND (se.expiry_date IS NULL OR se.expiry_date <= '2000-01-01' OR se.expiry_date = '1111-11-11')
    `);

    // Keep goods_transfer_items in sync when the transfer line is still null.
    await sequelize.query(`
      UPDATE goods_transfer_items gti
      INNER JOIN goods_transfers gt
        ON gt.id = gti.transfer_id
      INNER JOIN store_entries se
        ON se.reference_number = CONCAT('GT-', gt.transfer_no)
       AND se.product_id = gti.product_id
       AND se.facilityId = gt.facility_id
       AND se.type = 'transfer'
       AND se.expiry_date IS NOT NULL
       AND se.expiry_date > '2000-01-01'
      SET gti.expiry_date = DATE(se.expiry_date)
      WHERE gti.expiry_date IS NULL
         OR gti.expiry_date <= '2000-01-01'
         OR gti.expiry_date = '1111-11-11'
    `);

    // Merge leftover no-expiry movement rows into the only dated lot at that branch.
    await sequelize.query(`
      UPDATE store_entries se
      INNER JOIN (
        SELECT
          branchId,
          product_id,
          facilityId,
          MIN(DATE(expiry_date)) AS target_expiry
        FROM store_entries
        WHERE expiry_date IS NOT NULL
          AND expiry_date > '2000-01-01'
          AND expiry_date <> '1111-11-11'
          AND LOWER(TRIM(IFNULL(branch_name, ''))) IN ('for sales', 'for sale')
        GROUP BY branchId, product_id, facilityId
        HAVING COUNT(DISTINCT DATE(expiry_date)) = 1
      ) lot
        ON lot.branchId = se.branchId
       AND lot.product_id = se.product_id
       AND lot.facilityId = se.facilityId
      SET se.expiry_date = lot.target_expiry
      WHERE (se.expiry_date IS NULL OR se.expiry_date <= '2000-01-01' OR se.expiry_date = '1111-11-11')
        AND LOWER(TRIM(IFNULL(se.branch_name, ''))) IN ('for sales', 'for sale')
        AND LOWER(IFNULL(se.type, '')) IN ('transfer', 'sales', 'adjustment')
    `);
  },

  async down() {
    // Irreversible data repair — expiry stamps cannot be safely undone.
  },
};
