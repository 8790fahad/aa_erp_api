"use strict";

/**
 * Empty credit limit used to be stored as 0 and treated as unlimited.
 * 0 now means no credit; NULL means unlimited. Convert existing 0s on
 * registered customers so they stay unlimited until edited to 0.
 * Walk-in stays 0 (no credit).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE customers
         SET credit_limit = NULL
       WHERE credit_limit = 0
         AND LOWER(REPLACE(REPLACE(COALESCE(customer_type, ''), ' ', '-'), '_', '-'))
             NOT IN ('walk-in', 'walkin', 'walking')
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE customers
         SET credit_limit = 0
       WHERE credit_limit IS NULL
    `);
  },
};
