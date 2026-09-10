"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const business = await queryInterface
      .describeTable("business")
      .catch(() => null);
    if (business) {
      if (!business.login_hours_enabled) {
        await queryInterface.addColumn("business", "login_hours_enabled", {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment:
            "When true, only listed after-hours users may sign in outside opening–closing time",
        });
      }
      if (!business.login_opening_time) {
        await queryInterface.addColumn("business", "login_opening_time", {
          type: Sequelize.STRING(5),
          allowNull: false,
          defaultValue: "08:00",
          comment: "Daily opening time HH:mm (login hours timezone)",
        });
      }
      if (!business.login_closing_time) {
        await queryInterface.addColumn("business", "login_closing_time", {
          type: Sequelize.STRING(5),
          allowNull: false,
          defaultValue: "17:00",
          comment: "Daily closing time HH:mm (login hours timezone)",
        });
      }
      if (!business.login_hours_timezone) {
        await queryInterface.addColumn("business", "login_hours_timezone", {
          type: Sequelize.STRING(64),
          allowNull: false,
          defaultValue: "Africa/Lagos",
          comment: "IANA timezone for staff login opening/closing hours",
        });
      }
    }

    const users = await queryInterface.describeTable("users").catch(() => null);
    if (users && !users.allow_after_hours_login) {
      await queryInterface.addColumn("users", "allow_after_hours_login", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "When true, this user may sign in after closing until opening. Default all users checked.",
      });
    }
  },

  async down(queryInterface) {
    const users = await queryInterface.describeTable("users").catch(() => null);
    if (users?.allow_after_hours_login) {
      await queryInterface.removeColumn("users", "allow_after_hours_login");
    }

    const business = await queryInterface
      .describeTable("business")
      .catch(() => null);
    if (!business) return;
    if (business.login_hours_timezone) {
      await queryInterface.removeColumn("business", "login_hours_timezone");
    }
    if (business.login_closing_time) {
      await queryInterface.removeColumn("business", "login_closing_time");
    }
    if (business.login_opening_time) {
      await queryInterface.removeColumn("business", "login_opening_time");
    }
    if (business.login_hours_enabled) {
      await queryInterface.removeColumn("business", "login_hours_enabled");
    }
  },
};
