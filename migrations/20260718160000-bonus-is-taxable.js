"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const bonuses = await queryInterface.describeTable("bonuses");
    if (!bonuses.isTaxable) {
      await queryInterface.addColumn("bonuses", "isTaxable", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether bonus is included in taxable gross pay for PAYE",
      });
    }

    const profiles = await queryInterface.describeTable("employee_paye_profiles");
    if (!profiles.isBonusTaxable) {
      await queryInterface.addColumn("employee_paye_profiles", "isBonusTaxable", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether profile bonus amount is taxable for PAYE",
      });
    }
  },

  async down(queryInterface) {
    const bonuses = await queryInterface.describeTable("bonuses");
    if (bonuses.isTaxable) {
      await queryInterface.removeColumn("bonuses", "isTaxable");
    }

    const profiles = await queryInterface.describeTable("employee_paye_profiles");
    if (profiles.isBonusTaxable) {
      await queryInterface.removeColumn("employee_paye_profiles", "isBonusTaxable");
    }
  },
};
