"use strict";

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName);
  return indexes.some((idx) => idx.name === indexName);
}

/**
 * Enforce unique product/service name per facility.
 * Collation on products is typically case-insensitive (e.g. utf8mb4_general_ci),
 * so the unique index also blocks case-only duplicates.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    const table = "products";
    const indexName = "products_facility_name_uq";

    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT facility_id, LOWER(TRIM(name)) AS name_key, COUNT(*) AS cnt
      FROM products
      WHERE name IS NOT NULL AND TRIM(name) <> ''
      GROUP BY facility_id, LOWER(TRIM(name))
      HAVING cnt > 1
      LIMIT 20
    `);

    if (duplicates.length) {
      console.warn(
        `[${indexName}] Skipping unique index — ${duplicates.length}+ duplicate (facility_id, name) groups exist. Resolve duplicates then re-run.`,
      );
      console.warn(JSON.stringify(duplicates, null, 2));
      return;
    }

    if (!(await indexExists(queryInterface, table, indexName))) {
      await queryInterface.addIndex(table, ["facility_id", "name"], {
        unique: true,
        name: indexName,
      });
    }
  },

  async down(queryInterface) {
    const indexName = "products_facility_name_uq";
    if (await indexExists(queryInterface, "products", indexName)) {
      await queryInterface.removeIndex("products", indexName);
    }
  },
};
