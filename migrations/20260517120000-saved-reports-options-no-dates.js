"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "saved_reports";
    let columns = await queryInterface.describeTable(table);

    await queryInterface.changeColumn(table, "from_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await queryInterface.changeColumn(table, "to_date", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    columns = await queryInterface.describeTable(table);

    if (!columns.only_children) {
      await queryInterface.addColumn(table, "only_children", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      columns = await queryInterface.describeTable(table);
    }

    if (!columns.report_type) {
      await queryInterface.addColumn(table, "report_type", {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "full",
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const table = "saved_reports";
    const columns = await queryInterface.describeTable(table);

    if (columns.report_type) {
      await queryInterface.removeColumn(table, "report_type");
    }
    if (columns.only_children) {
      await queryInterface.removeColumn(table, "only_children");
    }

    await queryInterface.changeColumn(table, "from_date", {
      type: Sequelize.DATEONLY,
      allowNull: false,
    });
    await queryInterface.changeColumn(table, "to_date", {
      type: Sequelize.DATEONLY,
      allowNull: false,
    });
  },
};
