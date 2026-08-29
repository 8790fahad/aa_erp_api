"use strict";

/** Expand products.taxable ENUM for Non-Taxable / Exempted / Zero Rated. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface
      .describeTable("products")
      .catch(() => null);
    if (!table?.taxable) return;

    // Widen ENUM (keep legacy "Not Taxable" temporarily for safe migrate)
    await queryInterface.sequelize.query(`
      ALTER TABLE products
      MODIFY COLUMN taxable ENUM(
        'Taxable',
        'Not Taxable',
        'Non-Taxable',
        'Exempted',
        'Zero Rated'
      ) NOT NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE products
      SET taxable = 'Non-Taxable'
      WHERE taxable = 'Not Taxable'
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE products
      MODIFY COLUMN taxable ENUM(
        'Taxable',
        'Non-Taxable',
        'Exempted',
        'Zero Rated'
      ) NOT NULL
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface
      .describeTable("products")
      .catch(() => null);
    if (!table?.taxable) return;

    await queryInterface.sequelize.query(`
      UPDATE products
      SET taxable = 'Not Taxable'
      WHERE taxable IN ('Non-Taxable', 'Exempted', 'Zero Rated')
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE products
      MODIFY COLUMN taxable ENUM('Taxable', 'Not Taxable') NOT NULL
    `);
  },
};
