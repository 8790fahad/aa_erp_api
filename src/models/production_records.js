"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ProductionRecord extends Model {
    static associate(models) {
      // ProductionRecord has many ProductionRecordItems
      if (models.ProductionRecordItem) {
        ProductionRecord.hasMany(models.ProductionRecordItem, {
          foreignKey: "production_record_id",
          as: "finishedGoods",
          constraints: false,
        });
      }

      // ProductionRecord has many ProductionConsumptions
      if (models.ProductionConsumption) {
        ProductionRecord.hasMany(models.ProductionConsumption, {
          foreignKey: "production_record_id",
          as: "consumedItems",
          constraints: false,
        });
      }

      // ProductionRecord belongs to User (created_by)
      if (models.User) {
        ProductionRecord.belongsTo(models.User, {
          foreignKey: "created_by",
          as: "creator",
        });
      }

      // ProductionRecord belongs to Facility
      if (models.Facility) {
        ProductionRecord.belongsTo(models.Facility, {
          foreignKey: "facility_id",
          as: "facility",
        });
      }
    }
  }

  ProductionRecord.init(
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
      data:{
        type: DataTypes.JSON,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("draft", "completed", "cancelled"),
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
      modelName: "ProductionRecord",
      tableName: "production_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ProductionRecord;
};
