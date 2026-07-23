"use strict";
module.exports = (sequelize, DataTypes) => {
  const BankDiscrepancy = sequelize.define(
    "bank_discrepancy",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      bank_account_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      bank_transaction_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ledger_transaction_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      discrepancy_type: {
        type: DataTypes.ENUM(
          "missing_deposit",
          "unauthorized_withdrawal",
          "duplicate_entry",
          "amount_mismatch",
          "date_mismatch",
          "other"
        ),
        allowNull: false,
        defaultValue: "other",
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      bank_amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
        defaultValue: 0,
      },
      ledger_amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
        defaultValue: 0,
      },
      difference: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
        defaultValue: 0,
      },
      severity: {
        type: DataTypes.ENUM("low", "medium", "high"),
        allowNull: false,
        defaultValue: "medium",
      },
      status: {
        type: DataTypes.ENUM("open", "investigating", "resolved"),
        allowNull: false,
        defaultValue: "open",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      resolved_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      resolved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      tableName: "bank_discrepancies",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BankDiscrepancy.associate = function (models) {
    // BankDiscrepancy belongs to BankAccount
    if (models.bank_account) {
      BankDiscrepancy.belongsTo(models.bank_account, {
        foreignKey: "bank_account_id",
        targetKey: "id",
      });
    }
    // BankDiscrepancy belongs to BankStatementTransaction
    if (models.bank_statement_transaction) {
      BankDiscrepancy.belongsTo(models.bank_statement_transaction, {
        foreignKey: "bank_transaction_id",
        targetKey: "id",
      });
    }
    // BankDiscrepancy belongs to GeneralLedger
    if (models.GeneralLedger) {
      BankDiscrepancy.belongsTo(models.GeneralLedger, {
        foreignKey: "ledger_transaction_id",
        targetKey: "transaction_id",
      });
    }
  };

  return BankDiscrepancy;
};
