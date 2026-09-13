"use strict";

/** Per-process workflow email toggles (JSON). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (!table.workflow_mail_processes) {
      await queryInterface.addColumn("business", "workflow_mail_processes", {
        type: Sequelize.JSON,
        allowNull: true,
        comment:
          "Per-step email toggles. Keys: invoice.actor, invoice.verification, memo.approval, … Legacy parent keys (invoice) still apply to all steps. Missing key = on when master is on.",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (table?.workflow_mail_processes) {
      await queryInterface.removeColumn("business", "workflow_mail_processes");
    }
  },
};
