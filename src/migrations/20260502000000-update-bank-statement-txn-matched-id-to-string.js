'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('bank_statement_transactions', 'matched_transaction_id', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // If going down, convert it back to integer. Warning: data might be lost if it contains comma-separated values.
    // So we just change it back to integer.
    await queryInterface.changeColumn('bank_statement_transactions', 'matched_transaction_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  }
};
