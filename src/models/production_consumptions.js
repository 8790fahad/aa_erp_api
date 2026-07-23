"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionConsumption extends Model {
    static associate(models) {
      // ProductionConsumption belongs to ProductionRecord
      ProductionConsumption.belongsTo(models.ProductionRecord, {
        foreignKey: "production_record_id",
        as: "productionRecord",
        constraints: false,
      });
      
      // ProductionConsumption belongs to Product
      ProductionConsumption.belongsTo(models.Product, {
        foreignKey: "product_id",
        as: "product",
        targetKey: "sku",
        constraints: false,
      });
    }
  }

  ProductionConsumption.init(
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
      modelName: "ProductionConsumption",
      tableName: "production_consumptions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ProductionConsumption;
};