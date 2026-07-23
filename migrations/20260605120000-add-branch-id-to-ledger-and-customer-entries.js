"use strict";

/**
 * Branch attribution for money movement.
 *
 *  - `general_ledger.branch_id`  : which branch a posting belongs to. Set on
 *    credit sales (from the sale branch) and on customer payments/deposits
 *    (from the branch chosen on Receive Payment / Customer Deposit).
 *  - `customer_entries.branch_id`: same idea for the customer sub-ledger so
 *    payments can be reported per branch.
 *
 * Both are nullable so historical rows (and flows that don't carry a branch)
 * keep working.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const addBranchId = async (table) => {
      const cols = await queryInterface.describeTable(table).catch(() => null);
      if (cols && !cols.branch_id) {
        await queryInterface.addColumn(table, "branch_id", {
          type: Sequelize.INTEGER,
          allowNull: true,
        });
      }

      const [idx] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`${table}\` WHERE Key_name = 'idx_${table}_branch_id'`
      );
      if (!idx.length) {
        await queryInterface.sequelize
          .query(
            `ALTER TABLE \`${table}\` ADD INDEX \`idx_${table}_branch_id\` (\`branch_id\`)`
          )
          .catch(() => {});
      }
    };

    await addBranchId("general_ledger");
    await addBranchId("customer_entries");
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface
      .removeColumn("general_ledger", "branch_id")
      .catch(() => {});
    await queryInterface
      .removeColumn("customer_entries", "branch_id")
      .catch(() => {});
  },
};
