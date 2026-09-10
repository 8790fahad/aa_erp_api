"use strict";

/**
 * sale_workflows.id was not AUTO_INCREMENT / PK on some databases, so
 * Sequelize updates by id=0 could cancel every verification invoice.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "sale_workflows";
    const columns = await queryInterface.describeTable(table);
    if (!columns.id) return;

    await queryInterface.sequelize.query(`
      SET @next_id := (SELECT IFNULL(MAX(id), 0) FROM sale_workflows);
      UPDATE sale_workflows
      SET id = (@next_id := @next_id + 1)
      WHERE id = 0 OR id IS NULL
    `);

    const [indexes] = await queryInterface.sequelize.query(
      `SHOW INDEX FROM sale_workflows`,
    );
    const names = new Set(
      (indexes || []).map((i) => String(i.Key_name || i.Name || "")),
    );

    if (!names.has("PRIMARY")) {
      await queryInterface.sequelize.query(
        `ALTER TABLE sale_workflows
         MODIFY id INT NOT NULL AUTO_INCREMENT,
         ADD PRIMARY KEY (id)`,
      );
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
