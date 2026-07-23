'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Add 'Semi Finished' to the item_type enum in products table
      await queryInterface.changeColumn('products', 'item_type', {
        type: Sequelize.ENUM('Raw Material', 'Finished Good', 'Service', 'Resalable', 'By-Product', 'Semi Finished'),
        allowNull: false
      });
      
      console.log('Successfully added Semi Finished to products.item_type enum');
    } catch (error) {
      console.error('Error adding Semi Finished to products.item_type enum:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      // Remove 'Semi Finished' from the item_type enum in products table
      await queryInterface.changeColumn('products', 'item_type', {
        type: Sequelize.ENUM('Raw Material', 'Finished Good', 'Service', 'Resalable', 'By-Product'),
        allowNull: false
      });
      
      console.log('Successfully removed Semi Finished from products.item_type enum');
    } catch (error) {
      console.error('Error removing Semi Finished from products.item_type enum:', error);
      throw error;
    }
  }
};
