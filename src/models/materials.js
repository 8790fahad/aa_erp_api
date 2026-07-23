"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Material extends Model {
    static associate(models) {
      // Material belongs to Supplier
      if (models.SuppliersInfo) {
        Material.belongsTo(models.SuppliersInfo, {
          foreignKey: "supplier_id",
          as: "supplier",
        });
      }

      // Material has many BillOfMaterialItems
      if (models.BillOfMaterialItem) {
        Material.hasMany(models.BillOfMaterialItem, {
          foreignKey: "material_id",
          as: "bomItems",
        });
      }
    }
  }

  Material.init(
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      sku: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      unit: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pcs",
      },
      unit_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      stock_qty: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      reorder_level: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      supplier_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      account_code: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Chart of Accounts code for inventory valuation",
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
      },
      description: {
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
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "Material",
      tableName: "materials",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Material;
};
