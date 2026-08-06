"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;

    if (!table.invoice_closing_enabled) {
      await queryInterface.addColumn("business", "invoice_closing_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, unpaid non-credit invoices auto-reverse after daily closing time",
      });
    }

    if (!table.invoice_closing_time) {
      await queryInterface.addColumn("business", "invoice_closing_time", {
        type: Sequelize.STRING(5),
        allowNull: false,
        defaultValue: "17:00",
        comment: "Daily closing time HH:mm (local business timezone)",
      });
    }

    if (!table.invoice_closing_timezone) {
      await queryInterface.addColumn("business", "invoice_closing_timezone", {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: "Africa/Lagos",
        comment: "IANA timezone for invoice closing time",
      });
    }

    if (!table.invoice_closing_last_run) {
      await queryInterface.addColumn("business", "invoice_closing_last_run", {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: "Last date daily invoice auto-reverse ran",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (table.invoice_closing_last_run) {
      await queryInterface.removeColumn("business", "invoice_closing_last_run");
    }
    if (table.invoice_closing_timezone) {
      await queryInterface.removeColumn("business", "invoice_closing_timezone");
    }
    if (table.invoice_closing_time) {
      await queryInterface.removeColumn("business", "invoice_closing_time");
    }
    if (table.invoice_closing_enabled) {
      await queryInterface.removeColumn("business", "invoice_closing_enabled");
    }
  },
};
