"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");
    if (!table.document_header_style) {
      await queryInterface.addColumn("business", "document_header_style", {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "text",
        comment: "Document/print header layout: text | logo",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.document_header_style) {
      await queryInterface.removeColumn("business", "document_header_style");
    }
  },
};
