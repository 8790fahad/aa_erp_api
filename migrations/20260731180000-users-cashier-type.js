"use strict";

/** Cashier staff: cash collector vs bank-transfer collector. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable("users").catch(() => null);
    if (!table || table.cashier_type) return;

    await queryInterface.addColumn("users", "cashier_type", {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: "For Cashier role: cash | transfer",
    });
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("users").catch(() => null);
    if (!table || !table.cashier_type) return;
    await queryInterface.removeColumn("users", "cashier_type");
  },
};
