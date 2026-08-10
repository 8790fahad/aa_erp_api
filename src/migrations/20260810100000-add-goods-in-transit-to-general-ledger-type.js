"use strict";

/** Add goods_in_transit / git to general_ledger.type for supplier deposit → GIT. */
module.exports = {
  up: async (queryInterface) => {
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
        'receivable',
        'type',
        'revenue',
        'equity',
        'opening_balance',
        'unmatched',
        'payment',
        'discount',
        'deposit',
        'journal_entry',
        'charges',
        'interest',
        'goods_in_transit',
        'git'
      ) NOT NULL;
    `);
  },

  down: async (queryInterface) => {
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
        'receivable',
        'type',
        'revenue',
        'equity',
        'opening_balance',
        'unmatched',
        'payment',
        'discount',
        'deposit',
        'journal_entry',
        'charges',
        'interest'
      ) NOT NULL;
    `);
  },
};
