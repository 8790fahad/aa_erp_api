"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface
      .describeTable("store_entries")
      .catch(() => null);
    if (!table || table.po_no) return;

    await queryInterface.addColumn("store_entries", "po_no", {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: "Purchase order / requisition order ID for this receipt",
    });
  },

  async down(queryInterface) {
    const table = await queryInterface
      .describeTable("store_entries")
      .catch(() => null);
    if (!table || !table.po_no) return;
    await queryInterface.removeColumn("store_entries", "po_no");
  },
};
