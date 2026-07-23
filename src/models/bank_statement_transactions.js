"use strict";
module.exports = (sequelize, DataTypes) => {
  const BankStatementTransaction = sequelize.define(
    "bank_statement_transaction",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bank_statement_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      transaction_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      narration: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      debit: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      credit: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      transaction_type: {
        type: DataTypes.ENUM("debit", "credit"),
        allowNull: false,
      },
      reference: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      balance: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
      },
      reconciled: {
        type: DataTypes.ENUM("unmatched", "matched", "retain"),
        allowNull: false,
        defaultValue: "unmatched",
      },
      matched_transaction_id: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      row_number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "bank_statement_transactions",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BankStatementTransaction.associate = function (models) {
    // BankStatementTransaction belongs to BankStatement
    if (models.bank_statement) {
      BankStatementTransaction.belongsTo(models.bank_statement, {
        foreignKey: "bank_statement_id",
        targetKey: "id",
      });
    }
  };

  return BankStatementTransaction;
};
