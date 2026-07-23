"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class FinishedGood extends Model {
    static associate(models) {
      // FinishedGood belongs to ProductionOrder
      if (models.ProductionOrder) {
        FinishedGood.belongsTo(models.ProductionOrder, {
          foreignKey: "production_order_id",
          as: "productionOrder",
        });
      }
    }
  }

  FinishedGood.init(
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
      production_order_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      product_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      batch_no: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      quantity: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      cost_per_unit: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      status: {
        type: DataTypes.ENUM("available", "reserved", "dispatched", "sold"),
        allowNull: false,
        defaultValue: "available",
      },
      warehouse_location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expiry_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      account_code: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Chart of Accounts code for finished goods inventory",
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
      modelName: "FinishedGood",
      tableName: "finished_goods",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return FinishedGood;
};
