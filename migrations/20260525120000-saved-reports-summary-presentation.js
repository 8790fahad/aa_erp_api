"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "saved_reports";
    const columns = await queryInterface.describeTable(table);

    if (!columns.summary_presentation) {
      await queryInterface.addColumn(table, "summary_presentation", {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }
  },

  down: async (queryInterface) => {
    const table = "saved_reports";
    const columns = await queryInterface.describeTable(table);

    if (columns.summary_presentation) {
      await queryInterface.removeColumn(table, "summary_presentation");
    }
  },
};
