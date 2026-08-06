"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SaleFulfillmentLine extends Model {
    static associate(models) {
      if (models.SaleFulfillment) {
        SaleFulfillmentLine.belongsTo(models.SaleFulfillment, {
          foreignKey: "fulfillment_id",
          as: "fulfillment",
          constraints: false,
        });
      }
    }
  }

  SaleFulfillmentLine.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      fulfillment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      product_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      item_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      qty: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      qty_collected: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      store_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "SaleFulfillmentLine",
      tableName: "sale_fulfillment_lines",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return SaleFulfillmentLine;
};
