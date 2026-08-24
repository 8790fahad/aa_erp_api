"use strict";

/** Add credit_split and deposit to sale_workflows.payment_type */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse','credit_split','deposit')
      NOT NULL DEFAULT 'credit'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE sale_workflows
      SET payment_type = 'split'
      WHERE payment_type = 'credit_split'
    `);
    await queryInterface.sequelize.query(`
      UPDATE sale_workflows
      SET payment_type = 'credit'
      WHERE payment_type = 'deposit'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse')
      NOT NULL DEFAULT 'credit'
    `);
  },
};
