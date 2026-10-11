"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE loans
      MODIFY COLUMN paymentMode
      ENUM('bank', 'cheque', 'cash', 'others')
      NULL
      DEFAULT 'bank'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE loans SET paymentMode = 'bank' WHERE paymentMode = 'others'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE loans
      MODIFY COLUMN paymentMode
      ENUM('bank', 'cheque', 'cash')
      NULL
      DEFAULT 'bank'
    `);
  },
};
