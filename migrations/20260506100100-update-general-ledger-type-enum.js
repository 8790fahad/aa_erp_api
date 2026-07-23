"use strict";

module.exports = {
  up: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await queryInterface.sequelize.query(
      "ALTER TABLE `general_ledger` CHANGE `type` `type` ENUM('expenses','bank','payable','prepayment','accrued','tax','inventory','receivable','type','revenue','equity','opening_balance','unmatched','payment','discount','deposit','journal_entry','charges','interest') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;",
    );
  },

  down: async () => {
    // No-op: previous enum definition is unknown/snapshot-specific.
  },
};
