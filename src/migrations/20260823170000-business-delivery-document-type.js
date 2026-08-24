"use strict";

/**
 * Document type for the secondary dispatch slip:
 * delivery_order (with vehicle/driver) or goods_issue_note (no vehicle/driver).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.delivery_document_type) {
      await queryInterface.addColumn("business", "delivery_document_type", {
        type: Sequelize.ENUM("delivery_order", "goods_issue_note"),
        allowNull: false,
        defaultValue: "delivery_order",
        comment:
          "Secondary slip: Delivery Order (vehicle/driver) or Goods Issue Note",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.delivery_document_type) {
      await queryInterface.removeColumn("business", "delivery_document_type");
    }
  },
};
