module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
     ALTER TABLE invoices CHANGE created_by created_by VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
      `);
      await queryInterface.sequelize.query(`
       ALTER TABLE invoices CHANGE facility_id facility_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
   `);
      await queryInterface.sequelize.query(`
            ALTER TABLE invoices ADD INDEX('created_by')
         `);
         await queryInterface.sequelize.query(`
               ALTER TABLE invoices ADD INDEX('facility_id');
            `);

  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
       ALTER TABLE invoices
  DROP created_by
       `);
    await queryInterface.sequelize.query(`
          ALTER TABLE invoices DROP INDEX created_by;`);
  },
};
