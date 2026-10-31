"use strict";

/** Daily automatic hand-in save: on/off, time, timezone, and last run date. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;

    if (!table.recon_auto_save_enabled) {
      await queryInterface.addColumn("business", "recon_auto_save_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "When true, open hand-ins save automatically after the set time",
      });
    }
    if (!table.recon_auto_save_time) {
      await queryInterface.addColumn("business", "recon_auto_save_time", {
        type: Sequelize.STRING(5),
        allowNull: true,
        defaultValue: "18:00",
        comment: "Local HH:mm when automatic hand-in save runs",
      });
    }
    if (!table.recon_auto_save_timezone) {
      await queryInterface.addColumn("business", "recon_auto_save_timezone", {
        type: Sequelize.STRING(64),
        allowNull: true,
        defaultValue: "Africa/Lagos",
      });
    }
    if (!table.recon_auto_save_last_run) {
      await queryInterface.addColumn("business", "recon_auto_save_last_run", {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: "YYYY-MM-DD of the last automatic hand-in save",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (table.recon_auto_save_last_run) {
      await queryInterface.removeColumn("business", "recon_auto_save_last_run");
    }
    if (table.recon_auto_save_timezone) {
      await queryInterface.removeColumn("business", "recon_auto_save_timezone");
    }
    if (table.recon_auto_save_time) {
      await queryInterface.removeColumn("business", "recon_auto_save_time");
    }
    if (table.recon_auto_save_enabled) {
      await queryInterface.removeColumn("business", "recon_auto_save_enabled");
    }
  },
};
