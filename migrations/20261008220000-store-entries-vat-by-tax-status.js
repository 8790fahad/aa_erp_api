"use strict";

/**
 * Fill store_entries.vat_amount from the product VAT status.
 * Taxable lines treat cost_price as including 7.5% VAT.
 * Non-Taxable, Exempted, and Zero Rated stay at 0.
 * cost_price is not changed. Safe to run again.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "store_entries";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (!desc.vat_amount) {
      await queryInterface.addColumn(table, "vat_amount", {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE store_entries se
      INNER JOIN products p
        ON p.sku = se.product_id
       AND p.facility_id = se.facilityId
      SET se.vat_amount = ROUND(
        (CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE se.qty_out END)
        * se.cost_price * 7.5 / 107.5
      , 2)
      WHERE p.taxable = 'Taxable'
        AND se.cost_price > 0
        AND COALESCE(se.vat_amount, 0) = 0
        AND (se.qty_in > 0 OR se.qty_out > 0)
    `);
  },

  async down(queryInterface) {
    const desc = await queryInterface.describeTable("store_entries").catch(() => null);
    if (!desc?.vat_amount) return;
    await queryInterface.sequelize.query(`
      UPDATE store_entries se
      INNER JOIN products p
        ON p.sku = se.product_id
       AND p.facility_id = se.facilityId
      SET se.vat_amount = 0
      WHERE p.taxable = 'Taxable'
        AND se.vat_amount = ROUND(
          (CASE WHEN se.qty_in > 0 THEN se.qty_in ELSE se.qty_out END)
          * se.cost_price * 7.5 / 107.5
        , 2)
    `);
  },
};
