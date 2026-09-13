"use strict";

/** Add apply_credit to sale_workflows.payment_type */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse','credit_split','deposit','card','apply_credit')
      NOT NULL DEFAULT 'credit'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE sale_workflows
      SET payment_type = 'deposit'
      WHERE payment_type = 'apply_credit'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse','credit_split','deposit','card')
      NOT NULL DEFAULT 'credit'
    `);
  },
};
