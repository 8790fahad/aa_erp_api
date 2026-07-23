"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class BillOfMaterial extends Model {
    static associate(models) {
      // BillOfMaterial has many BillOfMaterialItems
      if (models.BillOfMaterialItem) {
        BillOfMaterial.hasMany(models.BillOfMaterialItem, {
          foreignKey: "bom_id",
          as: "items",
        });
      }

      // BillOfMaterial has many ProductionOrders
      if (models.ProductionOrder) {
        BillOfMaterial.hasMany(models.ProductionOrder, {
          foreignKey: "bom_id",
          as: "productionOrders",
        });
      }
    }
  }

  BillOfMaterial.init(
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
      product_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      version: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "1.0",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "draft"),
        allowNull: false,
        defaultValue: "draft",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      total_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
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
      modelName: "BillOfMaterial",
      tableName: "bill_of_materials",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return BillOfMaterial;
};
