"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class GoodsTransfer extends Model {
    static associate(models) {
      if (models.GoodsTransferItem) {
        GoodsTransfer.hasMany(models.GoodsTransferItem, {
          foreignKey: "transfer_id",
          as: "items",
          onDelete: "CASCADE",
          constraints: false,
        });
      }
    }
  }

  GoodsTransfer.init(
    {
      id: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false,
      },
      transfer_no: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      source_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      destination_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      transfer_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "rejected", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
      initiated_by: { type: DataTypes.STRING(50), allowNull: true },
      initiated_by_name: { type: DataTypes.STRING(150), allowNull: true },
      approved_by: { type: DataTypes.STRING(50), allowNull: true },
      approved_by_name: { type: DataTypes.STRING(150), allowNull: true },
      approved_at: { type: DataTypes.DATE, allowNull: true },
      rejected_by: { type: DataTypes.STRING(50), allowNull: true },
      rejected_at: { type: DataTypes.DATE, allowNull: true },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "GoodsTransfer",
      tableName: "goods_transfers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return GoodsTransfer;
};
