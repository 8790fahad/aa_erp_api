"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class GoodsReceivedNote extends Model {
    static associate(models) {
      // GoodsReceivedNote belongs to PurchaseOrder
      GoodsReceivedNote.belongsTo(models.PurchaseOrder, {
        foreignKey: "po_id",
        as: "purchaseOrder",
      });

      // GoodsReceivedNote has many GRNItems
      if (models.GRNItem) {
        GoodsReceivedNote.hasMany(models.GRNItem, {
          foreignKey: "grn_id",
          as: "items",
        });
      }
    }
  }

  GoodsReceivedNote.init(
    {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      po_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      grn_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      received_by: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      received_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
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
      modelName: "GoodsReceivedNote",
      tableName: "goods_received_notes",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return GoodsReceivedNote;
};
