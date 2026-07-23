"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CashTransfer extends Model {
    static associate(models) {
      // CashTransfer belongs to Business/Facility
      if (models.Business) {
        CashTransfer.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "business",
        });
      }

      // Creator profile is resolved in cashTransfer controller:
      // created_by (user id) → membership → users.email

      // CashTransfer belongs to Account (from_account)
      if (models.Account) {
        CashTransfer.belongsTo(models.Account, {
          foreignKey: "from_account",
          as: "fromAccount",
        });
      }

      // CashTransfer belongs to Account (to_account)
      if (models.Account) {
        CashTransfer.belongsTo(models.Account, {
          foreignKey: "to_account",
          as: "toAccount",
        });
      }
    }
  }

  CashTransfer.init(
    {
      transfer_id: {
        type: DataTypes.STRING(100),
        allowNull: false,
        primaryKey: true,
        unique: true,
        field: "transfer_id",
      },
      from_account: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "from_account",
      },
      to_account: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "to_account",
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        field: "amount",
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "remarks",
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "completed",
        field: "status",
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "date",
      },
      facilityId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "facilityId",
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "created_by",
      },
      reference_number: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "reference_number",
      },
      transaction_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: "cash_transfer",
        field: "transaction_type",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "updated_at",
      },
    },
    {
      sequelize,
      modelName: "CashTransfer",
      tableName: "cash_transfers",
      timestamps: false,
      indexes: [
        { fields: ["transfer_id"] },
        { fields: ["facilityId"] },
        { fields: ["status"] },
        { fields: ["created_by"] },
        { fields: ["from_account"] },
        { fields: ["to_account"] },
        { fields: ["date"] },
      ],
    }
  );

  return CashTransfer;
};