"use strict";

/** Process workflow emails on/off for the business. Default on. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (!table.workflow_mail_enabled) {
      await queryInterface.addColumn("business", "workflow_mail_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "When true, process workflow emails are sent. In-app notifications still work when false.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (table?.workflow_mail_enabled) {
      await queryInterface.removeColumn("business", "workflow_mail_enabled");
    }
  },
};
