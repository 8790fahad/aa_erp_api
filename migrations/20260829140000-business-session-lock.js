"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;

    if (!table.session_lock_enabled) {
      await queryInterface.addColumn("business", "session_lock_enabled", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, all users of this business auto-lock after idle minutes",
      });
    }

    if (!table.session_lock_idle_minutes) {
      await queryInterface.addColumn("business", "session_lock_idle_minutes", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 10,
        comment: "Idle minutes before session lock (1–240) for this business",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business").catch(() => null);
    if (!table) return;
    if (table.session_lock_idle_minutes) {
      await queryInterface.removeColumn("business", "session_lock_idle_minutes");
    }
    if (table.session_lock_enabled) {
      await queryInterface.removeColumn("business", "session_lock_enabled");
    }
  },
};
