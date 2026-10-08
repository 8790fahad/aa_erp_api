"use strict";

/** Discretionary rebates: a fixed amount given even when no volume target was reached. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(t).toLowerCase(),
    );
    if (names.includes("rebate_grants")) return;

    await queryInterface.createTable("rebate_grants", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      basis: {
        type: Sequelize.ENUM("sales", "purchase"),
        allowNull: false,
        defaultValue: "sales",
      },
      party_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      party_no: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL(20, 2),
        allowNull: false,
      },
      note: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      grant_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "paid"),
        allowNull: false,
        defaultValue: "pending",
      },
      payout_type: {
        type: Sequelize.ENUM("credit", "cash"),
        allowNull: false,
        defaultValue: "credit",
      },
      credit_note_number: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      mode_of_payment: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      payment_reference: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      bank_account_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      cheque_no: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_by: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      updated_by: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
      },
    });

    await queryInterface.addIndex("rebate_grants", ["facility_id"], {
      name: "idx_rebate_grants_facility",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("rebate_grants");
  },
};
