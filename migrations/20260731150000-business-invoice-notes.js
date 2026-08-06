"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.customer_notes) {
      await queryInterface.addColumn("business", "customer_notes", {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: "Thanks for your business.",
        comment: "Default customer notes shown on sales invoices",
      });
    }
    if (!table.terms_conditions) {
      await queryInterface.addColumn("business", "terms_conditions", {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null,
        comment: "Default terms & conditions shown on sales invoices",
      });
    }
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
