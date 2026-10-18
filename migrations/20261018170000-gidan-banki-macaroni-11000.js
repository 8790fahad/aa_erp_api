"use strict";

/**
 * GIDAN BANKI kept IRS Macaroni Cavatto (P003) at the company average
 * instead of the ₦11,000 opening cost. Put the stock lines and the
 * matching cost-of-sales / inventory ledger lines back to ₦11,000.
 * Selling-price revenue lines are left as they are.
 * Safe to run more than once.
 */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;

    await seq.query(`
      UPDATE general_ledger gl
      JOIN store_entries se
        ON CONVERT(se.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(gl.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
       AND CONVERT(se.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(gl.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
      JOIN branches b
        ON b.id = se.branchId
       AND b.branch_name = 'GIDAN BANKI'
      SET gl.dr = IF(gl.dr > 0, ROUND((se.qty_in + se.qty_out) * 11000, 2), gl.dr),
          gl.cr = IF(gl.cr > 0, ROUND((se.qty_in + se.qty_out) * 11000, 2), gl.cr)
      WHERE se.product_id = 'P003'
        AND se.type = 'sales'
        AND gl.type IN ('expenses', 'inventory')
        AND ABS(
          GREATEST(gl.dr, gl.cr)
          - ROUND((se.qty_in + se.qty_out) * se.cost_price, 2)
        ) < 0.05
    `);

    await seq.query(`
      UPDATE store_entries se
      JOIN branches b
        ON b.id = se.branchId
       AND b.branch_name = 'GIDAN BANKI'
      SET se.cost_price = 11000,
          se.vat_amount = 0
      WHERE se.product_id = 'P003'
        AND ABS(se.cost_price - 11000) > 0.001
    `);

    await seq.query(`
      UPDATE store_entries src
      JOIN store_entries dst
        ON CONVERT(src.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(dst.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
       AND CONVERT(src.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(dst.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
       AND src.product_id = dst.product_id
      JOIN branches b
        ON b.id = dst.branchId
       AND b.branch_name = 'GIDAN BANKI'
      SET src.cost_price = 11000,
          src.vat_amount = 0
      WHERE src.product_id = 'P003'
        AND src.type = 'transfer'
        AND src.qty_out > 0
        AND dst.type = 'transfer'
        AND dst.qty_in > 0
        AND ABS(src.cost_price - 11000) > 0.001
    `);

    await seq.query(`
      UPDATE goods_transfer_items i
      JOIN goods_transfers t
        ON t.id = i.transfer_id
      JOIN branches b
        ON b.id = t.destination_branch_id
       AND b.branch_name = 'GIDAN BANKI'
      SET i.cost_price = 11000
      WHERE i.product_id = 'P003'
        AND ABS(i.cost_price - 11000) > 0.001
    `);
  },

  async down() {
    // The previous average cost is not stored, so this data fix is not reversed.
  },
};
