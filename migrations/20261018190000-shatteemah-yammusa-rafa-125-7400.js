"use strict";

/**
 * Rafa Detargent(125x36pcs) (P022) at SHATTEEMAH STORE and YAMMUSA HOUSE
 * was kept at the company average (₦7,424.42) instead of the ₦7,400
 * opening cost. Put the stock lines, the transfer that carried that
 * average, and the matching cost-of-sales / inventory / input-VAT
 * ledger lines back to ₦7,400. Selling-price revenue lines are left
 * as they are. Safe to run more than once.
 */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;
    const branches = "'SHATTEEMAH STORE', 'YAMMUSA HOUSE'";
    const qtySql = "(se.qty_in + se.qty_out)";
    const newCogsUnit = "ROUND(7400 / 1.075, 2)";
    const newVatUnit = "ROUND(7400 - 7400 / 1.075, 2)";

    await seq.query(`
      UPDATE general_ledger gl
      JOIN store_entries se
        ON CONVERT(se.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(gl.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
       AND CONVERT(se.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(gl.facility_id USING utf8mb4) COLLATE utf8mb4_general_ci
      JOIN branches b
        ON b.id = se.branchId
       AND b.branch_name IN (${branches})
      SET gl.dr = CASE
            WHEN gl.dr <= 0 THEN gl.dr
            WHEN gl.transaction_description LIKE 'COGS [P022]%' THEN ROUND(${qtySql} * ${newCogsUnit}, 2)
            WHEN gl.transaction_description LIKE 'Input VAT [P022]%' THEN ROUND(${qtySql} * ${newVatUnit}, 2)
            WHEN gl.transaction_description LIKE 'Inventory reduction [P022]%' THEN ROUND(${qtySql} * ${newCogsUnit}, 2) + ROUND(${qtySql} * ${newVatUnit}, 2)
            ELSE gl.dr
          END,
          gl.cr = CASE
            WHEN gl.cr <= 0 THEN gl.cr
            WHEN gl.transaction_description LIKE 'COGS [P022]%' THEN ROUND(${qtySql} * ${newCogsUnit}, 2)
            WHEN gl.transaction_description LIKE 'Input VAT [P022]%' THEN ROUND(${qtySql} * ${newVatUnit}, 2)
            WHEN gl.transaction_description LIKE 'Inventory reduction [P022]%' THEN ROUND(${qtySql} * ${newCogsUnit}, 2) + ROUND(${qtySql} * ${newVatUnit}, 2)
            ELSE gl.cr
          END
      WHERE se.product_id = 'P022'
        AND ABS(se.cost_price - 7400) > 0.001
        AND (
          gl.transaction_description LIKE 'COGS [P022]%'
          OR gl.transaction_description LIKE 'Input VAT [P022]%'
          OR gl.transaction_description LIKE 'Inventory reduction [P022]%'
        )
    `);

    await seq.query(`
      UPDATE store_entries se
      JOIN branches b
        ON b.id = se.branchId
       AND b.branch_name IN (${branches})
      SET se.cost_price = 7400,
          se.vat_amount = IF(
            se.type = 'sales' AND IFNULL(se.vat_amount, 0) > 0,
            ROUND(${qtySql} * ${newVatUnit}, 2),
            0
          )
      WHERE se.product_id = 'P022'
        AND ABS(se.cost_price - 7400) > 0.001
    `);

    await seq.query(`
      UPDATE store_entries other
      JOIN store_entries known
        ON CONVERT(known.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(other.reference_number USING utf8mb4) COLLATE utf8mb4_general_ci
       AND CONVERT(known.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
         = CONVERT(other.facilityId USING utf8mb4) COLLATE utf8mb4_general_ci
       AND known.product_id = other.product_id
       AND known.id <> other.id
      JOIN branches b
        ON b.id = known.branchId
       AND b.branch_name IN (${branches})
      SET other.cost_price = 7400,
          other.vat_amount = 0
      WHERE known.product_id = 'P022'
        AND known.type = 'transfer'
        AND other.type = 'transfer'
        AND (
          (known.qty_out > 0 AND other.qty_in > 0)
          OR (known.qty_in > 0 AND other.qty_out > 0)
        )
        AND ABS(other.cost_price - 7400) > 0.001
    `);

    await seq.query(`
      UPDATE goods_transfer_items i
      JOIN goods_transfers t
        ON t.id = i.transfer_id
      JOIN branches b
        ON b.id IN (t.source_branch_id, t.destination_branch_id)
       AND b.branch_name IN (${branches})
      SET i.cost_price = 7400
      WHERE i.product_id = 'P022'
        AND ABS(i.cost_price - 7400) > 0.001
    `);
  },

  async down() {
    // The previous average cost is not stored, so this data fix is not reversed.
  },
};
