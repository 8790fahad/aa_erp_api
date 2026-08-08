"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.customer_notes) {
      // TEXT cannot use DEFAULT in MySQL/MariaDB — add nullable, then backfill
      await queryInterface.addColumn("business", "customer_notes", {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Default customer notes shown on sales invoices",
      });
    }

    if (!table.terms_conditions) {
      await queryInterface.addColumn("business", "terms_conditions", {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Default terms & conditions shown on sales invoices",
      });
    }

    // App-level default; applied via UPDATE (not column DEFAULT)
    await queryInterface.sequelize.query(`
      UPDATE business
      SET customer_notes = 'Thanks for your business.'
      WHERE customer_notes IS NULL OR customer_notes = ''
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.customer_notes) {
      await queryInterface.removeColumn("business", "customer_notes");
    }
    if (table.terms_conditions) {
      await queryInterface.removeColumn("business", "terms_conditions");
    }
  },
};
