module.exports = {
    up: async (queryInterface, Sequelize) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE business CONVERT TO CHARACTER SET latin1 COLLATE latin1_swedish_ci;
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE customers CONVERT TO CHARACTER SET latin1 COLLATE latin1_swedish_ci;
      `);
    },

    down: async (queryInterface, Sequelize) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE business CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE customers CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);
    },
  };
