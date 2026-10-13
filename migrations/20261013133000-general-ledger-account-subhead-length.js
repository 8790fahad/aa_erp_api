"use strict";

/**
 * Journal approval stored the account name in account_subhead.
 * Names such as the Jaiz bank account are longer than VARCHAR(50),
 * so the insert was rejected and the journal rolled back.
 */

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const rows = await sequelize.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'general_ledger'
         AND COLUMN_NAME = 'account_subhead'
       LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT },
    );
    if (!rows.length) return;
    if (Number(rows[0].len) >= 300) return;

    await sequelize.query(
      `ALTER TABLE \`general_ledger\`
       CHANGE \`account_subhead\` \`account_subhead\`
       VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`,
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const rows = await sequelize.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'general_ledger'
         AND COLUMN_NAME = 'account_subhead'
       LIMIT 1`,
      { type: sequelize.QueryTypes.SELECT },
    );
    if (!rows.length || Number(rows[0].len) <= 50) return;

    await sequelize.query(
      `ALTER TABLE \`general_ledger\`
       CHANGE \`account_subhead\` \`account_subhead\`
       VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`,
    );
  },
};
