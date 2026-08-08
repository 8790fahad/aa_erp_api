"use strict";

/** Add basis (sales | purchase) to rebate_rules. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("rebate_rules");
    if (!table.basis) {
      await queryInterface.addColumn("rebate_rules", "basis", {
        type: Sequelize.ENUM("sales", "purchase"),
        allowNull: false,
        defaultValue: "sales",
        after: "name",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("rebate_rules");
    if (table.basis) {
      await queryInterface.removeColumn("rebate_rules", "basis");
    }
  },
};
