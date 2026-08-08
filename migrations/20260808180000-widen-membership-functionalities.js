"use strict";

/**
 * Permission lists are stored as comma-separated names and now exceed
 * VARCHAR(255)/VARCHAR(1000). Widen to TEXT so add-staff / permission
 * updates no longer fail with ER_DATA_TOO_LONG on `functionalities`.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'membership'",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `membership` WHERE Field IN ('functionalities', 'access_to')",
    );
    const byField = Object.fromEntries(
      (columns || []).map((c) => [c.Field, c]),
    );

    const needsWiden = (col) => {
      if (!col) return false;
      const t = String(col.Type || "").toLowerCase();
      // Keep mediumtext/longtext/text as-is; widen varchar/char/tinytext.
      if (t === "text" || t.startsWith("mediumtext") || t.startsWith("longtext")) {
        return false;
      }
      return (
        t.startsWith("varchar") ||
        t.startsWith("char") ||
        t === "tinytext"
      );
    };

    // Always ensure TEXT even when SHOW TYPE is ambiguous / already partially widened.
    const ensureText = async (column) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE \`membership\` MODIFY COLUMN \`${column}\` TEXT NULL`,
      );
    };

    if (!byField.functionalities || needsWiden(byField.functionalities)) {
      await ensureText("functionalities");
    }

    if (!byField.access_to || needsWiden(byField.access_to)) {
      await ensureText("access_to");
    }
  },

  down: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    await queryInterface.changeColumn("membership", "functionalities", {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });
    await queryInterface.changeColumn("membership", "access_to", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
  },
};
