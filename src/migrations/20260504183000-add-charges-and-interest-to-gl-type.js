'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('general_ledger', 'type', {
      type: Sequelize.ENUM(
        "expenses",
        "bank",
        "payable",
        "prepayment",
        "accrued",
        "unmatched",
        "tax",
        "deposit",
        "discount",
        "inventory",
        "receivable",
        "revenue",
        "opening_balance",
        "payment",
        "journal_entry",
        "charges",
        "interest"
      ),
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Note: If you have records with 'charges' or 'interest' and you run 'down',
    // those records will cause errors or be invalidated in the database.
    await queryInterface.changeColumn('general_ledger', 'type', {
      type: Sequelize.ENUM(
        "expenses",
        "bank",
        "payable",
        "prepayment",
        "accrued",
        "unmatched",
        "tax",
        "deposit",
        "discount",
        "inventory",
        "receivable",
        "revenue",
        "opening_balance",
        "payment",
        "journal_entry"
      ),
      allowNull: false,
    });
  }
};
