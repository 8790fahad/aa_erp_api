"use strict";

/**
 * Ensure general_ledger.status always uses posted for live entries.
 * - Adds posted/reversed to ENUM if needed
 * - Defaults new rows to posted
 * - Backfills existing non-reversed rows to posted
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE general_ledger
      MODIFY COLUMN status
      ENUM('paid','unpaid','saved','pending','partial','posted','reversed')
      NOT NULL
      DEFAULT 'posted'
    `);

    await queryInterface.sequelize.query(`
      UPDATE general_ledger
      SET status = 'posted'
      WHERE status IS NULL
         OR status IN ('paid','unpaid','saved','pending','partial')
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE general_ledger
      MODIFY COLUMN status
      ENUM('paid','unpaid','saved','pending','partial','posted')
      NOT NULL
      DEFAULT 'saved'
    `);
  },
};
