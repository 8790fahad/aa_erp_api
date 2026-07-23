"use strict";
module.exports = (sequelize, DataTypes) => {
  const BankStatement = sequelize.define(
    "bank_statement",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bank_account_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      statement_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      file_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      file_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      total_transactions: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      uploaded_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "processed", "error"),
        defaultValue: "pending",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "bank_statements",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BankStatement.associate = function (models) {
    // BankStatement belongs to BankAccount
    if (models.bank_account) {
      BankStatement.belongsTo(models.bank_account, {
        foreignKey: "bank_account_id",
        targetKey: "id",
      });
    }
    // BankStatement has many BankStatementTransactions
    if (models.bank_statement_transaction) {
      BankStatement.hasMany(models.bank_statement_transaction, {
        foreignKey: "bank_statement_id",
        as: "transactions",
      });
    }
  };

  return BankStatement;
};
