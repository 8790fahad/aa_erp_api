"use strict";

/**
 * Persist generated loan voucher reference from number_generator.
 * Idempotent — safe on MySQL (no ADD COLUMN IF NOT EXISTS).
 * Does not use AFTER chequeNumber — that column may not exist on all DBs.
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
      console.log("Skipping loans.referenceNumber — MySQL/MariaDB only");
      return;
    }

    // Ensure chequeNumber exists (model expects it; older DBs may lack it)
    if (!(await columnExists(queryInterface, "loans", "chequeNumber"))) {
      const chequeSpec = {
        type: Sequelize.STRING(50),
        allowNull: true,
      };
      if (await columnExists(queryInterface, "loans", "cashHead")) {
        chequeSpec.after = "cashHead";
      } else if (await columnExists(queryInterface, "loans", "paymentMode")) {
        chequeSpec.after = "paymentMode";
      }
      await queryInterface.addColumn("loans", "chequeNumber", chequeSpec);
    }

    if (!(await columnExists(queryInterface, "loans", "referenceNumber"))) {
      const spec = {
        type: Sequelize.STRING(50),
        allowNull: true,
      };
      // Prefer AFTER chequeNumber only when that column exists
      if (await columnExists(queryInterface, "loans", "chequeNumber")) {
        spec.after = "chequeNumber";
      } else if (await columnExists(queryInterface, "loans", "cashHead")) {
        spec.after = "cashHead";
      } else if (await columnExists(queryInterface, "loans", "bankHead")) {
        spec.after = "bankHead";
      } else if (await columnExists(queryInterface, "loans", "paymentMode")) {
        spec.after = "paymentMode";
      }

      await queryInterface.addColumn("loans", "referenceNumber", spec);
    }
  },

  down: async (queryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    if (await columnExists(queryInterface, "loans", "referenceNumber")) {
      await queryInterface.removeColumn("loans", "referenceNumber");
    }
  },
};
