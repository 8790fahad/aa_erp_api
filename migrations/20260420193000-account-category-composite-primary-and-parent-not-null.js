"use strict";

module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // Normalize parent_code values before NOT NULL enforcement.
    // Existing FK requires parent_code to reference an existing code.
    // For blank/missing/invalid parent references, self-reference the row code.
    await queryInterface.sequelize.query(
      `UPDATE account_category ac
       LEFT JOIN account_category p ON p.code = ac.parent_code
       SET ac.parent_code = ac.code
       WHERE ac.parent_code IS NULL
          OR TRIM(ac.parent_code) = ''
          OR p.code IS NULL`,
    );

    // Ensure id stays unique after dropping PRIMARY KEY from id.
    await queryInterface.sequelize.query(
      "ALTER TABLE account_category ADD UNIQUE KEY unique_account_category_id (id)",
    ).catch(() => {});

    // Keep parent_code nullable to remain compatible with FK ON DELETE SET NULL.
    await queryInterface.sequelize.query(
      "ALTER TABLE account_category MODIFY parent_code VARCHAR(20) NULL",
    );

    // Switch PRIMARY KEY to (code, facility_id).
    await queryInterface.sequelize.query(
      "ALTER TABLE account_category DROP PRIMARY KEY, ADD PRIMARY KEY (code, facility_id)",
    );
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    // Revert to id as primary key.
    await queryInterface.sequelize.query(
      "ALTER TABLE account_category DROP PRIMARY KEY, ADD PRIMARY KEY (id)",
    );

    // Restore parent_code nullable.
    await queryInterface.sequelize.query(
      "ALTER TABLE account_category MODIFY parent_code VARCHAR(20) NULL",
    );
  },
};

