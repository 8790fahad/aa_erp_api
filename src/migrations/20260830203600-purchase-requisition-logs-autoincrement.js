"use strict";

/**
 * Creating a purchase requisition fails with:
 *   Duplicate entry '0' for key 'PRIMARY'
 *
 * The INSERT into purchase_requisition has no integer PK. The BEFORE INSERT
 * trigger `trg_mr_insert` writes into `logs` without `id`. `logs.id` is a
 * PRIMARY KEY but not AUTO_INCREMENT, so MariaDB (NO_AUTO_VALUE_ON_ZERO)
 * stores 0. A second logs insert (aa_pr_ai_logs, or the next PR) then collides.
 *
 * requisition_details.id has the same missing AUTO_INCREMENT (next line insert).
 */

async function ensureAutoIncrementPk(queryInterface, tableName) {
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

  const [maxRows] = await queryInterface.sequelize.query(
    `SELECT COALESCE(MAX(\`id\`), 0) AS max_id FROM \`${tableName}\``,
  );
  const next = Number(maxRows?.[0]?.max_id || 0) + 1;

  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`id\` INT(11) NOT NULL AUTO_INCREMENT`,
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` AUTO_INCREMENT = ${next}`,
  );
}

async function ensurePrNoPrimary(queryInterface) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.some(
    (t) => String(t).toLowerCase() === "purchase_requisition",
  );
  if (!exists) return;

  const [indexes] = await queryInterface.sequelize.query(
    `SHOW INDEX FROM \`purchase_requisition\` WHERE Key_name = 'PRIMARY'`,
  );
  if (indexes && indexes.length) return;

  await queryInterface.sequelize.query(
    `ALTER TABLE \`purchase_requisition\` ADD PRIMARY KEY (\`pr_no\`)`,
  );
}

module.exports = {
  async up(queryInterface) {
    await ensureAutoIncrementPk(queryInterface, "logs");
    await ensureAutoIncrementPk(queryInterface, "requisition_details");
    await ensurePrNoPrimary(queryInterface);

    // Duplicate of aa_pr_ai_logs / aa_pr_au_logs — both insert into logs
    // without an id, which is what produced Duplicate entry '0'.
    await queryInterface.sequelize.query(
      "DROP TRIGGER IF EXISTS `trg_mr_insert`",
    );
    await queryInterface.sequelize.query(
      "DROP TRIGGER IF EXISTS `mr_update_trigger`",
    );
  },

  async down() {
    // Keep AUTO_INCREMENT and the single remaining logs triggers.
  },
};
