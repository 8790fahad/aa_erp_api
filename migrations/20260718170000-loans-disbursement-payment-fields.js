"use strict";

/**
 * Persist planned loan disbursement source (mode + cash/bank head) on the loan row.
 * Idempotent — safe on MySQL (no ADD COLUMN IF NOT EXISTS).
 */
async function columnExists(queryInterface, tableName, columnName) {
  try {
    const description = await queryInterface.describeTable(tableName);
    return Object.prototype.hasOwnProperty.call(description, columnName);
  } catch (e) {
    return false;
  }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") {
      console.log("Skipping loans payment columns — MySQL/MariaDB only");
      return;
    }

    if (!(await columnExists(queryInterface, "loans", "paymentMode"))) {
      const paymentModeSpec = {
        type: Sequelize.ENUM("bank", "cheque", "cash"),
        allowNull: true,
        defaultValue: "bank",
      };
      if (await columnExists(queryInterface, "loans", "receivableHead")) {
        paymentModeSpec.after = "receivableHead";
      }
      await queryInterface.addColumn("loans", "paymentMode", paymentModeSpec);
    }

    if (!(await columnExists(queryInterface, "loans", "bankHead"))) {
      const bankHeadSpec = {
        type: Sequelize.STRING(100),
        allowNull: true,
      };
      if (await columnExists(queryInterface, "loans", "paymentMode")) {
        bankHeadSpec.after = "paymentMode";
      }
      await queryInterface.addColumn("loans", "bankHead", bankHeadSpec);
    }

    if (!(await columnExists(queryInterface, "loans", "cashHead"))) {
      const cashHeadSpec = {
        type: Sequelize.STRING(100),
        allowNull: true,
      };
      if (await columnExists(queryInterface, "loans", "bankHead")) {
        cashHeadSpec.after = "bankHead";
      }
      await queryInterface.addColumn("loans", "cashHead", cashHeadSpec);
    }

    // chequeNumber is used by the loan model but may be missing on older DBs
    if (!(await columnExists(queryInterface, "loans", "chequeNumber"))) {
      const chequeSpec = {
        type: Sequelize.STRING(100),
        allowNull: true,
      };
      if (await columnExists(queryInterface, "loans", "cashHead")) {
        chequeSpec.after = "cashHead";
      }
      await queryInterface.addColumn("loans", "chequeNumber", chequeSpec);
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    if (await columnExists(queryInterface, "loans", "cashHead")) {
      await queryInterface.removeColumn("loans", "cashHead");
    }
    if (await columnExists(queryInterface, "loans", "bankHead")) {
      await queryInterface.removeColumn("loans", "bankHead");
    }
    if (await columnExists(queryInterface, "loans", "paymentMode")) {
      await queryInterface.removeColumn("loans", "paymentMode");
    }
  },
};
