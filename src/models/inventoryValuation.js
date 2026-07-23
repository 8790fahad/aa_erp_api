"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class InventoryValuation extends Model {
    static associate(models) {
      // Each valuation belongs to a Product
      if (models.Product) {
        InventoryValuation.belongsTo(models.Product, {
          foreignKey: "product_id",
          as: "product",
          key : "sku",
        });
      }
    }
  }

  InventoryValuation.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // Link to product
      product_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
          model: "products",
          key: "sku",
        },
      },
      quantity_on_hand: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      avg_unit_cost: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_value: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // Audit
      facility_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "InventoryValuation",
      tableName: "inventory_valuation",
      timestamps: true,
      createdAt: false, // we only care about updated_at
      updatedAt: "updated_at",
      indexes: [
        { fields: ["product_id"] },
        { fields: ["facility_id"] },
      ],
    }
  );

  return InventoryValuation;
};
