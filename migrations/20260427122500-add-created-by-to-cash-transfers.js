"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'cash_transfers';",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `cash_transfers` LIKE 'created_by';",
    );
    if (Array.isArray(columns) && columns.length > 0) {
      return;
    }

    await queryInterface.addColumn("cash_transfers", "created_by", {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addIndex("cash_transfers", ["created_by"], {
      name: "idx_cash_transfers_created_by",
    });
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      return;
    }

    const [tables] = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'cash_transfers';",
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      return;
    }

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `cash_transfers` LIKE 'created_by';",
    );
    if (!Array.isArray(columns) || columns.length === 0) {
      return;
    }

    await queryInterface
      .removeIndex("cash_transfers", "idx_cash_transfers_created_by")
      .catch(() => {});
    await queryInterface.removeColumn("cash_transfers", "created_by");
  },
};
