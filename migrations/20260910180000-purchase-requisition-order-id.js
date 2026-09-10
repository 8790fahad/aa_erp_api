"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface
      .describeTable("purchase_requisition")
      .catch(() => null);
    if (!table) return;

    if (!table.order_id) {
      await queryInterface.addColumn("purchase_requisition", "order_id", {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: "Supplier/internal order ID, unique per facility",
      });
    }

    const indexes = await queryInterface.showIndex("purchase_requisition");
    const hasUnique = (indexes || []).some(
      (idx) =>
        String(idx.name) === "purchase_requisition_facility_order_id_unique",
    );
    if (!hasUnique) {
      await queryInterface.addIndex(
        "purchase_requisition",
        ["facilityId", "order_id"],
        {
          unique: true,
          name: "purchase_requisition_facility_order_id_unique",
        },
      );
    }
  },

  async down(queryInterface) {
    const table = await queryInterface
      .describeTable("purchase_requisition")
      .catch(() => null);
    if (!table) return;

    const indexes = await queryInterface.showIndex("purchase_requisition");
    const hasUnique = (indexes || []).some(
      (idx) =>
        String(idx.name) === "purchase_requisition_facility_order_id_unique",
    );
    if (hasUnique) {
      await queryInterface.removeIndex(
        "purchase_requisition",
        "purchase_requisition_facility_order_id_unique",
      );
    }
    if (table.order_id) {
      await queryInterface.removeColumn("purchase_requisition", "order_id");
    }
  },
};
