"use strict";

/**
 * Bank account type used at collection: bank (transfer) or pos.
 * Existing accounts stay bank.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("bank_accounts");
    if (!table.channel) {
      await queryInterface.addColumn("bank_accounts", "channel", {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: "bank",
      });
    }
    await queryInterface.sequelize.query(
      `UPDATE bank_accounts
       SET channel = 'bank'
       WHERE channel IS NULL OR channel = ''`,
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("bank_accounts");
    if (table.channel) {
      await queryInterface.removeColumn("bank_accounts", "channel");
    }
  },
};
