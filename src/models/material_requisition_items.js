"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class MaterialRequisitionItem extends Model {
    static associate(models) {
      // MaterialRequisitionItem belongs to MaterialRequisition
      MaterialRequisitionItem.belongsTo(models.MaterialRequisition, {
        foreignKey: "requisition_id",
        as: "requisition",
      });

      // MaterialRequisitionItem belongs to Product
      MaterialRequisitionItem.belongsTo(models.Product, {
        foreignKey: "sku",
        as: "product",
      });
    }
  }

  MaterialRequisitionItem.init(
    {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      requisition_id: {
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
      product_code: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      unit_of_measure: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      quantity_requested: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0.0,
      },
      quantity_approved: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: 0.0,
      },
      quantity_issued: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: true,
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
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      modelName: "MaterialRequisitionItem",
      tableName: "material_requisition_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return MaterialRequisitionItem;
};
