"use strict";

/** Store the VAT on each stock receipt line, next to cost_price. */
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
      INNER JOIN supplier_entries p
        ON p.receiptNo = se.reference_number
       AND p.facilityId = se.facilityId
       AND p.type = 'purchase'
       AND p.link_id = se.product_id
      SET se.vat_amount = p.vat_amount
      WHERE p.vat_amount > 0
        AND (se.vat_amount IS NULL OR se.vat_amount = 0)
    `);
  },

  async down(queryInterface) {
    const table = "store_entries";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (desc?.vat_amount) {
      await queryInterface.removeColumn(table, "vat_amount");
    }
  },
};
