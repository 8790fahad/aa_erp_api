"use strict";

/** Track last rebate-progress reminder so 50/75/100% emails are not repeated. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("rebate_statuses");
    if (!table.last_reminder_pct) {
      await queryInterface.addColumn("rebate_statuses", "last_reminder_pct", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        after: "cheque_no",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("rebate_statuses");
    if (table.last_reminder_pct) {
      await queryInterface.removeColumn("rebate_statuses", "last_reminder_pct");
    }
  },
};
