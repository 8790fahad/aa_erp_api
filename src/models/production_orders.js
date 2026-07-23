"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionOrder extends Model {
    static associate(models) {
      // ProductionOrder belongs to BillOfMaterial
      if (models.BillOfMaterial) {
        ProductionOrder.belongsTo(models.BillOfMaterial, {
          foreignKey: "bom_id",
          as: "billOfMaterial",
        });
      }

      // ProductionOrder has many ProductionOrderItems
      if (models.ProductionOrderItem) {
        ProductionOrder.hasMany(models.ProductionOrderItem, {
          foreignKey: "production_order_id",
          as: "items",
        });
      }

      // ProductionOrder has many MaterialIssuances
      if (models.MaterialIssuance) {
        ProductionOrder.hasMany(models.MaterialIssuance, {
          foreignKey: "production_order_id",
          as: "materialIssuances",
        });
      }
    }
  }

  ProductionOrder.init(
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
      bom_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      order_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      quantity_planned: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      quantity_actual: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      status: {
        type: DataTypes.ENUM(
          "planned",
          "in_progress",
          "completed",
          "cancelled"
        ),
        allowNull: false,
        defaultValue: "planned",
      },
      start_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "urgent"),
        allowNull: false,
        defaultValue: "medium",
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
      modelName: "ProductionOrder",
      tableName: "production_orders",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ProductionOrder;
};
