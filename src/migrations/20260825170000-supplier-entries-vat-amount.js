"use strict";

/** Persist per-line VAT on supplier purchase entries (product / expense bills). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "supplier_entries";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (!desc) return;
    if (!desc.vat_amount) {
      await queryInterface.addColumn(table, "vat_amount", {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }

    // Backfill from existing per-item tax rows (description contains product name)
    await queryInterface.sequelize.query(`
      UPDATE supplier_entries se
      INNER JOIN (
        SELECT
          p.entry_id,
          COALESCE(SUM(t.cost), 0) AS vat_sum
        FROM supplier_entries p
        INNER JOIN supplier_entries t
          ON t.receiptNo = p.receiptNo
         AND t.facilityId = p.facilityId
         AND t.type = 'tax'
         AND t.cost > 0
         AND (
           LOWER(t.description) LIKE CONCAT('%on purchase of ', LOWER(p.description), '%')
           OR LOWER(t.description) LIKE CONCAT('%purchase of ', LOWER(p.description), '%')
         )
        WHERE p.type = 'purchase'
        GROUP BY p.entry_id
      ) x ON x.entry_id = se.entry_id
      SET se.vat_amount = x.vat_sum
      WHERE se.type = 'purchase'
        AND (se.vat_amount IS NULL OR se.vat_amount = 0)
    `);
  },

  async down(queryInterface) {
    const table = "supplier_entries";
    const desc = await queryInterface.describeTable(table).catch(() => null);
    if (desc?.vat_amount) {
      await queryInterface.removeColumn(table, "vat_amount");
    }
  },
};
