'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('business', 'valuation_date', {
      type: Sequelize.ENUM('All', 'Daily', 'Weekly', 'Monthly', 'Yearly'),
      allowNull: true,
      defaultValue: 'All',
      comment: 'Inventory Valuation frequency - All (default), Daily, Weekly, Monthly, Yearly',
      after: 'default_valuation_source'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('business', 'valuation_date');
  }
};
