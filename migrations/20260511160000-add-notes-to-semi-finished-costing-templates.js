"use strict";

/** Full legacy JSON blob on semi_finished_costing_templates (phpMyAdmin / exports). */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'semi_finished_costing_templates';",
    );
    if (!Array.isArray(tables) || tables.length === 0) return;

    const [cols] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM semi_finished_costing_templates LIKE 'notes';",
    );
    if (Array.isArray(cols) && cols.length > 0) return;

    await queryInterface.addColumn("semi_finished_costing_templates", "notes", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    try {
      await queryInterface.removeColumn(
        "semi_finished_costing_templates",
        "notes",
      );
    } catch (_) {
      /* ignore */
    }
  },
};
