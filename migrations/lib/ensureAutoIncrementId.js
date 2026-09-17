"use strict";

/**
 * Dump imports often leave INT id columns without AUTO_INCREMENT / PRIMARY KEY,
 * and may contain duplicate ids. Sequelize then inserts id=NULL and MySQL
 * raises ER_NO_DEFAULT_FOR_FIELD.
 */
async function ensureAutoIncrementId(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.some(
    (t) => String(t).toLowerCase() === tableName.toLowerCase(),
  );
  if (!exists) return;

  const desc = await queryInterface.describeTable(tableName);
  if (!desc.id) return;

  const [cols] = await queryInterface.sequelize.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE 'id'`,
  );
  const extra = String(cols?.[0]?.Extra || "").toLowerCase();
  if (extra.includes("auto_increment")) return;

  const [pk] = await queryInterface.sequelize.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`,
  );
  const hasPk = !!(pk && pk.length);

  if (!hasPk) {
    if (!desc._fix_id) {
      await queryInterface.sequelize.query(
        `ALTER TABLE \`${tableName}\` ADD COLUMN \`_fix_id\` INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST`,
      );
    }
    await queryInterface.sequelize.query(
      `UPDATE \`${tableName}\` SET \`id\` = \`_fix_id\``,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${tableName}\` DROP INDEX \`_fix_id\`, DROP COLUMN \`_fix_id\``,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (\`id\`)`,
    );
  }

  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`id\` INT NOT NULL AUTO_INCREMENT`,
  );
}

module.exports = { ensureAutoIncrementId };
