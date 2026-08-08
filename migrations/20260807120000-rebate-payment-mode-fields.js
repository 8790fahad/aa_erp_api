"use strict";

/** Add payment-mode fields for rebate cash/bank/cheque payouts. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("rebate_statuses");

    if (!table.mode_of_payment) {
      await queryInterface.addColumn("rebate_statuses", "mode_of_payment", {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
        after: "credit_note_number",
      });
    }
    if (!table.payment_reference) {
      await queryInterface.addColumn("rebate_statuses", "payment_reference", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "mode_of_payment",
      });
    }
    if (!table.bank_account_id) {
      await queryInterface.addColumn("rebate_statuses", "bank_account_id", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "payment_reference",
      });
    }
    if (!table.cheque_no) {
      await queryInterface.addColumn("rebate_statuses", "cheque_no", {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: null,
        after: "bank_account_id",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("rebate_statuses");
    for (const col of [
      "cheque_no",
      "bank_account_id",
      "payment_reference",
      "mode_of_payment",
    ]) {
      if (table[col]) await queryInterface.removeColumn("rebate_statuses", col);
    }
  },
};
