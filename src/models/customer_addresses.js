"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CustomerAddress extends Model {
    static associate(models) {
      if (models.Customer) {
        CustomerAddress.belongsTo(models.Customer, {
          foreignKey: "customer_no",
          targetKey: "customerNo",
          constraints: false,
          as: "customer",
        });
      }
    }
  }

  CustomerAddress.init(
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
      customer_no: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      address_type: {
        type: DataTypes.ENUM("billing", "shipping"),
        allowNull: false,
        defaultValue: "billing",
      },
      attention: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      street1: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
      street2: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      zip: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      fax: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "CustomerAddress",
      tableName: "customer_addresses",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["facility_id", "customer_no"] },
        { fields: ["address_type"] },
      ],
    },
  );

  return CustomerAddress;
};
