'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Modify the type ENUM to add 'receivable'
    await queryInterface.sequelize.query(`
      ALTER TABLE general_ledger
      MODIFY COLUMN type ENUM(
        'expenses',
        'bank',
        'payable',
        'prepayment',
        'accrued',
        'tax',
        'inventory',
        'receivable'
      ) NOT NULL;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Revert back to original ENUM values
    await queryInterface.sequelize.query(`
      ALTER TABLE general_ledger
      MODIFY COLUMN type ENUM(
        'expenses',
        'bank',
        'payable',
        'prepayment',
        'accrued',
        'tax',
        'inventory'
      ) NOT NULL;
    `);
  }
};













