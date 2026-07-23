"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class MaterialRequisition extends Model {
    static associate(models) {
      // MaterialRequisition has many MaterialRequisitionItems
      if (models.MaterialRequisitionItem) {
        MaterialRequisition.hasMany(models.MaterialRequisitionItem, {
          foreignKey: "requisition_id",
          as: "items",
        });
      }

      // MaterialRequisition belongs to User (created_by)
      if (models.User) {
        MaterialRequisition.belongsTo(models.User, {
          foreignKey: "created_by",
          as: "creator",
        });
      }

      // MaterialRequisition belongs to Facility
      if (models.Facility) {
        MaterialRequisition.belongsTo(models.Facility, {
          foreignKey: "facility_id",
          as: "facility",
        });
      }
    }
  }

  MaterialRequisition.init(
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
      requisition_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      product_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      product_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      quantity_required: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      status: {
        type: DataTypes.ENUM("draft", "pending", "approved", "rejected", "completed"),
        allowNull: false,
        defaultValue: "draft",
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
      requesting_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      source_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      approved_by: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
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
        allowNull: true,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "MaterialRequisition",
      tableName: "material_requisitions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return MaterialRequisition;
};