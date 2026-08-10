"use strict";

/** Add target_type + supplier/customer targeting for rebate rules. */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable("rebate_rules");

    if (!table.target_type) {
      await queryInterface.addColumn("rebate_rules", "target_type", {
        type: Sequelize.ENUM("product", "supplier", "customer"),
        allowNull: false,
        defaultValue: "product",
        after: "basis",
      });
    }
    if (!table.supplier_no) {
      await queryInterface.addColumn("rebate_rules", "supplier_no", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "product_sku",
      });
    }
    if (!table.supplier_name) {
      await queryInterface.addColumn("rebate_rules", "supplier_name", {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: null,
        after: "supplier_no",
      });
    }
    if (!table.customer_no) {
      await queryInterface.addColumn("rebate_rules", "customer_no", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "supplier_name",
      });
    }
    if (!table.customer_name) {
      await queryInterface.addColumn("rebate_rules", "customer_name", {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: null,
        after: "customer_no",
      });
    }
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("rebate_rules");
    for (const col of [
      "customer_name",
      "customer_no",
      "supplier_name",
      "supplier_no",
      "target_type",
    ]) {
      if (table[col]) {
        await queryInterface.removeColumn("rebate_rules", col);
      }
    }
  },
};
