"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SupplierContact extends Model {
    static associate(models) {
      if (models.SuppliersInfo) {
        SupplierContact.belongsTo(models.SuppliersInfo, {
          foreignKey: "supplier_number",
          targetKey: "supplier_number",
          constraints: false,
          as: "supplier",
        });
      }
    }
  }

  SupplierContact.init(
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
      salutation: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      first_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      last_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      work_phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      mobile: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      is_primary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "SupplierContact",
      tableName: "supplier_contacts",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["facility_id", "supplier_number"] },
        { fields: ["is_primary"] },
      ],
    },
  );

  return SupplierContact;
};
