"use strict";

/**
 * Ensure general_ledger.status always uses posted for live entries.
 * - Adds posted/reversed to ENUM if needed
 * - Defaults new rows to posted
 * - Backfills existing non-reversed rows to posted
 *
 * Note: MySQL revalidates every column on MODIFY. Older general_ledger rows
 * often have zero-date defaults on updated_at/created_at, which fail under
 * NO_ZERO_DATE. Fix timestamps in the same ALTER (and relax sql_mode briefly).
 */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface.sequelize;

    await qi.query(`SET @__fb_sql_mode := @@SESSION.sql_mode`);
    await qi.query(`
      SET SESSION sql_mode = REPLACE(
        REPLACE(@@SESSION.sql_mode, 'NO_ZERO_DATE', ''),
        'NO_ZERO_IN_DATE',
        ''
      )
    `);

    try {
      await qi.query(`
        ALTER TABLE general_ledger
          MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          MODIFY COLUMN status
            ENUM('paid','unpaid','saved','pending','partial','posted','reversed')
            NOT NULL
            DEFAULT 'posted'
      `);
    } finally {
      await qi.query(`SET SESSION sql_mode = @__fb_sql_mode`);
    }

    await qi.query(`
      UPDATE general_ledger
      SET status = 'posted'
      WHERE status IS NULL
         OR status IN ('paid','unpaid','saved','pending','partial')
    `);
  },

  async down(queryInterface) {
    const qi = queryInterface.sequelize;

    await qi.query(`SET @__fb_sql_mode := @@SESSION.sql_mode`);
    await qi.query(`
      SET SESSION sql_mode = REPLACE(
        REPLACE(@@SESSION.sql_mode, 'NO_ZERO_DATE', ''),
        'NO_ZERO_IN_DATE',
        ''
      )
    `);

    try {
      await qi.query(`
        ALTER TABLE general_ledger
          MODIFY COLUMN status
            ENUM('paid','unpaid','saved','pending','partial','posted')
            NOT NULL
            DEFAULT 'saved'
      `);
    } finally {
      await qi.query(`SET SESSION sql_mode = @__fb_sql_mode`);
    }
  },
};
