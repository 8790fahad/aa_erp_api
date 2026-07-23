"use strict";

module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log("Skipping public_holidays migration — MySQL/MariaDB only");
      return;
    }

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`public_holidays\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`facilityId\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`holiday_name\` VARCHAR(255) NOT NULL,
        \`holiday_date\` DATE NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`is_recurring\` TINYINT(1) NOT NULL DEFAULT 0,
        \`status\` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        \`created_by\` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_public_holidays_facility_date\` (\`facilityId\`, \`holiday_date\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS `public_holidays`;");
  },
};
