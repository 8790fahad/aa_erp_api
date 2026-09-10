"use strict";

/**
 * sale_workflows.id was not AUTO_INCREMENT / PK on some databases, so
 * Sequelize updates by id=0 could cancel every verification invoice.
 */
module.exports = {
  up: async (queryInterface) => {
    const table = "sale_workflows";
    const columns = await queryInterface.describeTable(table);
    if (!columns.id) return;

    const [maxRows] = await queryInterface.sequelize.query(
      "SELECT IFNULL(MAX(id), 0) AS m FROM sale_workflows",
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    let next = Number(maxRows?.m || 0);

    const zeros = await queryInterface.sequelize.query(
      "SELECT sale_code, facility_id FROM sale_workflows WHERE id = 0",
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    for (const row of zeros || []) {
      next += 1;
      await queryInterface.sequelize.query(
        "UPDATE sale_workflows SET id = ? WHERE facility_id = ? AND sale_code = ? AND id = 0 LIMIT 1",
        { replacements: [next, row.facility_id, row.sale_code] },
      );
    }

    const [indexes] = await queryInterface.sequelize.query(
      "SHOW INDEX FROM sale_workflows",
    );
    const names = new Set(
      (indexes || []).map((i) => String(i.Key_name || "")),
    );

    if (!names.has("PRIMARY")) {
      await queryInterface.sequelize.query(
        "ALTER TABLE sale_workflows MODIFY id INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (id)",
      );
    }

    if (!names.has("sale_workflows_facility_sale_unique")) {
      await queryInterface.addIndex(table, ["facility_id", "sale_code"], {
        unique: true,
        name: "sale_workflows_facility_sale_unique",
      });
    }
  },

  down: async () => {},
};
