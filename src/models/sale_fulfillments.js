"use strict";
const { Model } = require("sequelize");

const FULFILLMENT_STATUSES = ["pending", "printed", "collecting", "collected"];

module.exports = (sequelize, DataTypes) => {
  class SaleFulfillment extends Model {
    static associate(models) {
      if (models.SaleFulfillmentLine) {
        SaleFulfillment.hasMany(models.SaleFulfillmentLine, {
          foreignKey: "fulfillment_id",
          as: "lines",
          onDelete: "CASCADE",
          constraints: false,
        });
      }
      if (models.Branch) {
        SaleFulfillment.belongsTo(models.Branch, {
          foreignKey: "branch_id",
          targetKey: "id",
          constraints: false,
          as: "branch",
        });
      }
    }
  }

  SaleFulfillment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      sale_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      pack_code: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "pending",
      },
      printed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      collected_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "SaleFulfillment",
      tableName: "sale_fulfillments",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return SaleFulfillment;
};

module.exports.FULFILLMENT_STATUSES = FULFILLMENT_STATUSES;
