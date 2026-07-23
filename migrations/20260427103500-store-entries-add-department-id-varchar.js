"use strict";

module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const [columns] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM `store_entries` LIKE 'departmentId'",
    );

    if (!columns.length) {
      await queryInterface.sequelize.query(
        "ALTER TABLE `store_entries` ADD `departmentId` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL",
      );
      return;
    }

    await queryInterface.sequelize.query(
      "ALTER TABLE `store_entries` CHANGE `departmentId` `departmentId` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL",
    );
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize
      .query("ALTER TABLE `store_entries` DROP COLUMN `departmentId`")
      .catch(() => {});
  },
};

