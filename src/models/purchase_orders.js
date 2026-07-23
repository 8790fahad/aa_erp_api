"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PurchaseOrder extends Model {
    static associate(models) {
      // PurchaseOrder belongs to Supplier
      if (models.SuppliersInfo) {
        PurchaseOrder.belongsTo(models.SuppliersInfo, {
          foreignKey: "supplier_number",
          targetKey: "supplier_number",
          as: "supplier",
        });
      }

      // PurchaseOrder has many PurchaseOrderItems
      if (models.PurchaseOrderItem) {
        PurchaseOrder.hasMany(models.PurchaseOrderItem, {
          foreignKey: "po_id",
          as: "items",
        });
      }

      // PurchaseOrder has many GoodsReceivedNotes
      if (models.GoodsReceivedNote) {
        PurchaseOrder.hasMany(models.GoodsReceivedNote, {
          foreignKey: "po_id",
          as: "grns",
        });
      }
    }
  }

  PurchaseOrder.init(
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
      supplier_number: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      po_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      total_amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      expected_delivery_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: false,
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
      modelName: "PurchaseOrder",
      tableName: "purchase_orders",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PurchaseOrder;
};
