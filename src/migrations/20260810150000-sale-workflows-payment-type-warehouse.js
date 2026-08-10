"use strict";

/** Add warehouse to sale_workflows.payment_type for special invoice treatment. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit', 'cash', 'transfer', 'split', 'bank', 'warehouse')
      NOT NULL
      DEFAULT 'credit'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE sale_workflows
      SET payment_type = 'cash'
      WHERE payment_type = 'warehouse'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE sale_workflows
      MODIFY COLUMN payment_type
      ENUM('credit', 'cash', 'transfer', 'split', 'bank')
      NOT NULL
      DEFAULT 'credit'
    `);
  },
};
