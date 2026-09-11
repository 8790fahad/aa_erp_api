"use strict";

/**
 * sale_workflows.id was not AUTO_INCREMENT / PK on some databases, so
 * Sequelize updates by id=0 could cancel every verification invoice.
 *
 * Do not combine SET + UPDATE in one sequelize.query() — mysql2 does not
 * enable multipleStatements, so MySQL parses only the SET and then errors
 * at UPDATE. Session variables also do not survive across pooled connections.
 */
module.exports = {
  up: async (queryInterface) => {
    const table = "sale_workflows";
    const sequelize = queryInterface.sequelize;

    let columns;
    try {
      columns = await queryInterface.describeTable(table);
    } catch (err) {
      console.warn(`  ⚠ skip ${table}: ${err.message}`);
      return;
    }
    if (!columns.id) return;

    const [maxRows] = await sequelize.query(
      `SELECT IFNULL(MAX(id), 0) AS max_id FROM \`${table}\``,
    );
    let nextId = Number(maxRows?.[0]?.max_id || 0);

    const [zeroRows] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE id = 0 OR id IS NULL`,
    );
    const zeroCount = Number(zeroRows?.[0]?.cnt || 0);

    for (let i = 0; i < zeroCount; i += 1) {
      nextId += 1;
      await sequelize.query(
        `UPDATE \`${table}\`
         SET id = :nextId
         WHERE id = 0 OR id IS NULL
         LIMIT 1`,
        { replacements: { nextId } },
      );
    }

    const [indexes] = await sequelize.query(`SHOW INDEX FROM \`${table}\``);
    const names = new Set(
      (indexes || []).map((i) => String(i.Key_name || i.Name || "")),
    );

    if (!names.has("PRIMARY")) {
      await sequelize.query(
        `ALTER TABLE \`${table}\`
         MODIFY id INT NOT NULL AUTO_INCREMENT,
         ADD PRIMARY KEY (id)`,
      );
    } else if (!columns.id.autoIncrement) {
      try {
        await sequelize.query(
          `ALTER TABLE \`${table}\` MODIFY id INT NOT NULL AUTO_INCREMENT`,
        );
      } catch (err) {
        console.warn(`  ⚠ AUTO_INCREMENT on ${table}.id: ${err.message}`);
      }
    }

    if (!names.has("sale_workflows_facility_sale_unique")) {
      await queryInterface.addIndex(table, ["facility_id", "sale_code"], {
        unique: true,
        name: "sale_workflows_facility_sale_unique",
      });
    }
  },

  down: async () => {
    // Keep the PK — reversing it would recreate the id=0 bug.
  },
};
