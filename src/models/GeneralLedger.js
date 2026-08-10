"use strict";

/**
 * General ledger posting model (`general_ledger`).
 *
 * Direct expense / imprest (`directExpenses` in account.js) expects:
 * - Balanced DR/CR per batch (expense + optional input VAT DR, payment CR).
 * - `type`: expenses | tax | payment (ENUM must match DB).
 * - `transaction_ref` unique per line; `reference_number` ties to impress / invoice ref.
 * - `account_subhead`: parent_code or 0; must match AccountCategory hierarchy.
 * - `facility_id`, `transaction_date`, `purpose_of_payment`, `transaction_description` required.
 *
 * Validate amounts and account codes in the controller before create; this model does not enforce double-entry.
 */
module.exports = (sequelize, DataTypes) => {
  const GeneralLedger = sequelize.define(
    "GeneralLedger",
    {
      transaction_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      transaction_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      project_id: { type: DataTypes.INTEGER, allowNull: true },
      account_code: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      account_subhead: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      dr: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      cr: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      account_description: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      transaction_description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      reference_number: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      purpose_of_payment: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      payee: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      bank_account_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      cheque_no: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      mode_of_payment: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("paid", "unpaid", "saved", "pending", "partial"),
        allowNull: false,
        defaultValue: "saved",
      },
      reconciled: {
        type: DataTypes.ENUM("unmatched", "matched", "retain"),
        allowNull: false,
        defaultValue: "unmatched",
      },
      type: {
        type: DataTypes.ENUM(
          "expenses",
          "bank",
          "payable",
          "prepayment",
          "accrued",
          "unmatched",
          "tax",
          "deposit",
          "discount",
          "inventory",
          "receivable",
          "revenue",
          "opening_balance",
          "payment",
          "journal_entry",
          "charges",
          "interest",
          "goods_in_transit",
          "git"
        ),
        allowNull: false,
      },
      transaction_ref: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
    },
    {
      tableName: "general_ledger",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true, // ✅ Prevent camelCase conversion
    }
  );

  GeneralLedger.associate = function (models) {
    if (models.Business) {
      GeneralLedger.belongsTo(models.Business, {
        foreignKey: "facility_id",
        targetKey: "id",
      });
    }

    // GeneralLedger.account_code references AccountCategory.code.
    // Aliased as "account_category" so includes can use that name in Sequelize.col() refs.
    if (models.AccountCategory) {
      GeneralLedger.belongsTo(models.AccountCategory, {
        foreignKey: "account_code",
        targetKey: "code",
        as: "account_category",
        constraints: false,
      });
    }
  };

  GeneralLedger.addHook("beforeValidate", (instance) => {
    if (instance.transaction_date == null || instance.transaction_date === "") {
      return;
    }
    const { validatePostingDate } = require("../utils/validatePostingDate");
    instance.transaction_date = validatePostingDate(instance.transaction_date, {
      field: "transaction_date",
    });
  });

  return GeneralLedger;
};
