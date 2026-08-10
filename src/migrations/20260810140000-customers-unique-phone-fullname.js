"use strict";

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName);
  return indexes.some((idx) => idx.name === indexName);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const table = "customers";
    const indexName = "customers_facility_phone_fullname_uq";

    // Empty string collides under UNIQUE; MySQL allows multiple NULLs.
    await queryInterface.sequelize.query(`
      UPDATE customers
      SET phone = NULL
      WHERE phone IS NOT NULL AND TRIM(phone) = ''
    `);

    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT facilityId, phone, fullname, COUNT(*) AS cnt
      FROM customers
      WHERE phone IS NOT NULL AND TRIM(phone) <> ''
      GROUP BY facilityId, phone, fullname
      HAVING cnt > 1
      LIMIT 20
    `);

    if (duplicates.length) {
      console.warn(
        `[${indexName}] Skipping unique index — ${duplicates.length}+ duplicate (facilityId, phone, fullname) row groups exist. Resolve duplicates then re-run.`,
      );
      console.warn(JSON.stringify(duplicates, null, 2));
      return;
    }

    if (!(await indexExists(queryInterface, table, indexName))) {
      await queryInterface.addIndex(table, ["facilityId", "phone", "fullname"], {
        unique: true,
        name: indexName,
      });
    }
  },

  async down(queryInterface) {
    const indexName = "customers_facility_phone_fullname_uq";
    if (await indexExists(queryInterface, "customers", indexName)) {
      await queryInterface.removeIndex("customers", indexName);
    }
  },
};
