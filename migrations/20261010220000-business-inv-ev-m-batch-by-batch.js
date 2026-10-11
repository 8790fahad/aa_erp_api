"use strict";

/** Add Batch by Batch (specific identification) to inventory valuation methods. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table?.inv_ev_m) return;
    const type = String(table.inv_ev_m.type || "");
    if (!type.toLowerCase().includes("enum")) return;

    await queryInterface.sequelize.query(`
      ALTER TABLE business
      MODIFY COLUMN inv_ev_m
        ENUM('Weighted Average Cost', 'LIFO', 'FIFO', 'Batch by Batch')
        NOT NULL DEFAULT 'Weighted Average Cost'
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table?.inv_ev_m) return;
    const type = String(table.inv_ev_m.type || "");
    if (!type.toLowerCase().includes("enum")) return;

    await queryInterface.sequelize.query(`
      UPDATE business
      SET inv_ev_m = 'Weighted Average Cost'
      WHERE inv_ev_m = 'Batch by Batch'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE business
      MODIFY COLUMN inv_ev_m
        ENUM('Weighted Average Cost', 'LIFO', 'FIFO')
        NOT NULL DEFAULT 'Weighted Average Cost'
    `);
  },
};
