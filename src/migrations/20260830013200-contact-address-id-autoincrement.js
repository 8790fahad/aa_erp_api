"use strict";

/**
 * customer_contacts / customer_addresses (and supplier twins) were created
 * with `id INT NOT NULL` but no AUTO_INCREMENT. Sequelize inserts NULL for
 * the PK and MySQL raises ER_BAD_NULL_ERROR (1048).
 */
async function ensureAutoIncrementId(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.some(
    (t) => String(t).toLowerCase() === tableName.toLowerCase(),
  );
  if (!exists) return;

  const desc = await queryInterface.describeTable(tableName);
  if (!desc.id) return;

  const [indexes] = await queryInterface.sequelize.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`,
  );
  if (!indexes || !indexes.length) {
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (\`id\`)`,
    );
  }

  const [cols] = await queryInterface.sequelize.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE 'id'`,
  );
  const extra = String(cols?.[0]?.Extra || "").toLowerCase();
  if (extra.includes("auto_increment")) return;

  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`id\` INT(11) NOT NULL AUTO_INCREMENT`,
  );
}

module.exports = {
  async up(queryInterface) {
    for (const table of [
      "customer_contacts",
      "customer_addresses",
      "supplier_contacts",
      "supplier_addresses",
    ]) {
      await ensureAutoIncrementId(queryInterface, table);
    }
  },

  async down() {
    // Keep AUTO_INCREMENT; reverting would break inserts again.
  },
};
