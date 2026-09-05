"use strict";

/** Add card to sale_workflows.payment_type (POS / card, collected like transfer). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse','credit_split','deposit','card')
      NOT NULL DEFAULT 'credit'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE sale_workflows
      SET payment_type = 'transfer'
      WHERE payment_type = 'card'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit','cash','transfer','split','bank','warehouse','credit_split','deposit')
      NOT NULL DEFAULT 'credit'
    `);
  },
};
