"use strict";

/**
 * Reversed stock came back at the cost after VAT was taken off.
 * Put those lines back on the purchase / opening cost, and keep the VAT
 * inside that cost so it is not taken off again.
 * Safe to run more than once.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE store_entries v
      JOIN (
        SELECT product_id, facilityId,
               ROUND(SUM(qty_in * cost_price) / SUM(qty_in), 2) AS receipt_cost
        FROM store_entries
        WHERE qty_in > 0
          AND type IN ('opening', 'opening_balance', 'purchase')
        GROUP BY product_id, facilityId
      ) r
        ON r.product_id = v.product_id
       AND r.facilityId = v.facilityId
      SET v.cost_price = r.receipt_cost,
          v.vat_amount = 0
      WHERE (v.destination = 'void' OR v.status = 'voided')
        AND v.qty_in > 0
        AND v.cost_price + 0.5 < r.receipt_cost
    `);

    await queryInterface.sequelize.query(`
      UPDATE store_entries
      SET vat_amount = 0
      WHERE (destination = 'void' OR status = 'voided')
        AND qty_in > 0
        AND IFNULL(vat_amount, 0) > 0
    `);
  },

  async down() {
    // The old net-of-VAT cost is not stored, so this data fix is not reversed.
  },
};
