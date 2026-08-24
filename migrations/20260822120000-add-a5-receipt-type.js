"use strict";

/**
 * Add `a5` to business.default_receipt_type ENUM and set YAMMUSA to A5.
 * Existing values: pdf | terminal. New: a5 (A5 paper invoice layout).
 */
module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      ALTER TABLE business
      MODIFY COLUMN default_receipt_type
        ENUM('pdf', 'terminal', 'a5')
        NOT NULL
        DEFAULT 'pdf'
        COMMENT 'Default receipt format: pdf (A4), a5 (A5), or terminal (80mm thermal)'
    `);

    // YAMMUSA GLOBAL FARMS & AGRO ALLIED SERVICES → A5
    await queryInterface.sequelize.query(`
      UPDATE business
      SET default_receipt_type = 'a5'
      WHERE id = '094c6e1e-dd07-48c4-a344-6e9d58cd7861'
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
    `);
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(`
      UPDATE business
      SET default_receipt_type = 'pdf'
      WHERE default_receipt_type = 'a5'
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE business
      MODIFY COLUMN default_receipt_type
        ENUM('pdf', 'terminal')
        NOT NULL
        DEFAULT 'pdf'
        COMMENT 'Default receipt format for sales — pdf (standard A4/A5 PDF) or terminal (80mm thermal printer)'
    `);
  },
};
