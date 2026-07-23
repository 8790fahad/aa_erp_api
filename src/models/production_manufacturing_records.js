"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionManufacturingRecord extends Model {
    static associate(models) {
      if (models.User) {
        ProductionManufacturingRecord.belongsTo(models.User, {
          foreignKey: "created_by",
          as: "creator",
        });
      }
    }
  }

  ProductionManufacturingRecord.init(
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
      production_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("job_specific", "joint_shared"),
        allowNull: false,
        defaultValue: "job_specific",
      },
      production_line: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      batch_no: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("draft", "completed", "cancelled", "rejected"),
        allowNull: false,
        defaultValue: "draft",
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
      modelName: "ProductionManufacturingRecord",
      tableName: "production_manufacturing_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return ProductionManufacturingRecord;
};
