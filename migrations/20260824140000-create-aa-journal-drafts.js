"use strict";

/**
 * Draft journal storage — entries live here until approved into general_ledger.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) =>
      typeof t === "string" ? t.toLowerCase() : String(Object.values(t)[0]).toLowerCase()
    );

    if (!names.includes("aa_journal_drafts")) {
      await queryInterface.createTable("aa_journal_drafts", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        transaction_ref: {
          type: Sequelize.STRING(100),
          allowNull: false,
          unique: true,
        },
        reference_number: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        entry_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        currency: {
          type: Sequelize.STRING(3),
          defaultValue: "NGN",
        },
        exchange_rate: {
          type: Sequelize.DECIMAL(18, 6),
          defaultValue: 1,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        total_debit: {
          type: Sequelize.DECIMAL(15, 2),
          defaultValue: 0,
        },
        total_credit: {
          type: Sequelize.DECIMAL(15, 2),
          defaultValue: 0,
        },
        status: {
          type: Sequelize.STRING(20),
          defaultValue: "draft",
          comment: "draft | approved",
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        created_by: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        updated_by: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        approved_by: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        approved_at: {
          type: Sequelize.DATE,
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
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          ),
        },
      });
      await queryInterface.addIndex("aa_journal_drafts", ["facility_id", "status"]);
      await queryInterface.addIndex("aa_journal_drafts", ["facility_id", "entry_date"]);
    }

    if (!names.includes("aa_journal_draft_lines")) {
      await queryInterface.createTable("aa_journal_draft_lines", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        transaction_ref: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        facility_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        line_number: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        account_code: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        account_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        line_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        line_description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        debit: {
          type: Sequelize.DECIMAL(15, 2),
          defaultValue: 0,
        },
        credit: {
          type: Sequelize.DECIMAL(15, 2),
          defaultValue: 0,
        },
        number_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        supplier_customer_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        supplier_customer_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        supplier_customer_type: {
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
            "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
          ),
        },
      });
      await queryInterface.addIndex("aa_journal_draft_lines", [
        "transaction_ref",
        "facility_id",
      ]);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("aa_journal_draft_lines").catch(() => {});
    await queryInterface.dropTable("aa_journal_drafts").catch(() => {});
  },
};
