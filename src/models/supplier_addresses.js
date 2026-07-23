"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SupplierAddress extends Model {
    static associate(models) {
      if (models.SuppliersInfo) {
        SupplierAddress.belongsTo(models.SuppliersInfo, {
          foreignKey: "supplier_number",
          targetKey: "supplier_number",
          constraints: false,
          as: "supplier",
        });
      }
    }
  }

  SupplierAddress.init(
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
      supplier_number: {
        type: DataTypes.STRING(10),
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
      modelName: "SupplierAddress",
      tableName: "supplier_addresses",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["facility_id", "supplier_number"] },
        { fields: ["address_type"] },
      ],
    },
  );

  return SupplierAddress;
};
