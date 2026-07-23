"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'account_category';",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `account_category` LIKE 'subcategory';",
    );
    if (Array.isArray(columns) && columns.length > 0) {
      return;
    }

    await queryInterface.addColumn("account_category", "subcategory", {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'account_category';",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `account_category` LIKE 'subcategory';",
    );
    if (!Array.isArray(columns) || columns.length === 0) {
      return;
    }

    await queryInterface.removeColumn("account_category", "subcategory");
  },
};
