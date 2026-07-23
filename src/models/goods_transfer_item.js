"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class GoodsTransferItem extends Model {
    static associate(models) {
      if (models.GoodsTransfer) {
        GoodsTransferItem.belongsTo(models.GoodsTransfer, {
          foreignKey: "transfer_id",
          as: "transfer",
          constraints: false,
        });
      }
      if (models.Product) {
        // products.sku is only unique with facility_id — no single-column FK in MySQL
        GoodsTransferItem.belongsTo(models.Product, {
          foreignKey: "product_id",
          targetKey: "sku",
          as: "product",
          constraints: false,
        });
      }
    }
  }

  GoodsTransferItem.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      transfer_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      product_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      item_name: { type: DataTypes.STRING(255), allowNull: true },
      quantity: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      unit_of_measure: { type: DataTypes.STRING(50), allowNull: true },
      cost_price: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      selling_price: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      mark_up: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
      supplier_code: { type: DataTypes.STRING(150), allowNull: true },
      supplier_name: { type: DataTypes.STRING(255), allowNull: true },
      from_qty_snapshot: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: true,
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
      modelName: "GoodsTransferItem",
      tableName: "goods_transfer_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return GoodsTransferItem;
};
