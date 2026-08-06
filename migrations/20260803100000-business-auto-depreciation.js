"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;

    if (!table.auto_depreciation_enabled) {
      await queryInterface.addColumn("business", "auto_depreciation_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "When true, cron runs bulk depreciation on schedule",
      });
    }

    if (!table.auto_depreciation_frequency) {
      await queryInterface.addColumn("business", "auto_depreciation_frequency", {
        type: Sequelize.ENUM("monthly", "quarterly", "yearly"),
        allowNull: false,
        defaultValue: "monthly",
        comment: "How often auto depreciation runs",
      });
    }

    if (!table.auto_depreciation_day) {
      await queryInterface.addColumn("business", "auto_depreciation_day", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Day of month (1-28) to run auto depreciation",
      });
    }

    if (!table.auto_depreciation_last_run) {
      await queryInterface.addColumn("business", "auto_depreciation_last_run", {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: "Last successful auto depreciation run date",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;

    if (table.auto_depreciation_last_run) {
      await queryInterface.removeColumn("business", "auto_depreciation_last_run");
    }
    if (table.auto_depreciation_day) {
      await queryInterface.removeColumn("business", "auto_depreciation_day");
    }
    if (table.auto_depreciation_frequency) {
      await queryInterface.removeColumn("business", "auto_depreciation_frequency");
    }
    if (table.auto_depreciation_enabled) {
      await queryInterface.removeColumn("business", "auto_depreciation_enabled");
    }
  },
};
