"use strict";

/** Add `rejected` to production costing / manufacturing status enums. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE production_costing_records
      MODIFY COLUMN status
      ENUM('draft', 'completed', 'cancelled', 'rejected')
      NOT NULL DEFAULT 'draft'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE production_manufacturing_records
      MODIFY COLUMN status
      ENUM('draft', 'completed', 'cancelled', 'rejected')
      NOT NULL DEFAULT 'draft'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE production_costing_records
      SET status = 'cancelled'
      WHERE status = 'rejected'
    `);
    await queryInterface.sequelize.query(`
      UPDATE production_manufacturing_records
      SET status = 'cancelled'
      WHERE status = 'rejected'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE production_costing_records
      MODIFY COLUMN status
      ENUM('draft', 'completed', 'cancelled')
      NOT NULL DEFAULT 'draft'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE production_manufacturing_records
      MODIFY COLUMN status
      ENUM('draft', 'completed', 'cancelled')
      NOT NULL DEFAULT 'draft'
    `);
  },
};
