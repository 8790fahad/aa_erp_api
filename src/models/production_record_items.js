"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionRecordItem extends Model {
    static associate(models) {
      // ProductionRecordItem belongs to ProductionRecord
      ProductionRecordItem.belongsTo(models.ProductionRecord, {
        foreignKey: "production_record_id",
        as: "productionRecord",
        constraints: false,
      });
      
      // ProductionRecordItem belongs to Product
      ProductionRecordItem.belongsTo(models.Product, {
        foreignKey: "product_id",
        as: "product",
        targetKey: "sku",
        constraints: false,
      });
    }
  }

  ProductionRecordItem.init(
    {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      production_record_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      product_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      product_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      quantity: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      batch_no: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      warehouse: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      unit_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "ProductionRecordItem",
      tableName: "production_record_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ProductionRecordItem;
};