"use strict";

/** Add yearly to product_sales_limits.period ENUM. */
module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const exists = (tables || []).some(
      (t) =>
        String(
          typeof t === "string" ? t : t.tableName || t.name || "",
        ).toLowerCase() === "product_sales_limits",
    );
    if (!exists) return;

    await queryInterface.sequelize.query(`
      ALTER TABLE product_sales_limits
      MODIFY COLUMN period ENUM('daily', 'weekly', 'monthly', 'yearly') NOT NULL
    `);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const exists = (tables || []).some(
      (t) =>
        String(
          typeof t === "string" ? t : t.tableName || t.name || "",
        ).toLowerCase() === "product_sales_limits",
    );
    if (!exists) return;

    await queryInterface.sequelize.query(`
      UPDATE product_sales_limits
      SET period = 'monthly'
      WHERE period = 'yearly'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE product_sales_limits
      MODIFY COLUMN period ENUM('daily', 'weekly', 'monthly') NOT NULL
    `);
  },
};
