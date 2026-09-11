"use strict";

/** Last YYYY-MM the 21st VAT payment reminder was sent (deadline is the 22nd). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (!table.vat_payment_reminder_last_sent) {
      await queryInterface.addColumn("business", "vat_payment_reminder_last_sent", {
        type: Sequelize.STRING(7),
        allowNull: true,
        defaultValue: null,
        comment: "YYYY-MM of last VAT payment reminder (sent on the 21st)",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (table?.vat_payment_reminder_last_sent) {
      await queryInterface.removeColumn("business", "vat_payment_reminder_last_sent");
    }
  },
};
