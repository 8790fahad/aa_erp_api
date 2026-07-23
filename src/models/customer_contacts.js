"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CustomerContact extends Model {
    static associate(models) {
      if (models.Customer) {
        CustomerContact.belongsTo(models.Customer, {
          foreignKey: "customer_no",
          targetKey: "customerNo",
          constraints: false,
          as: "customer",
        });
      }
    }
  }

  CustomerContact.init(
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
      modelName: "CustomerContact",
      tableName: "customer_contacts",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["facility_id", "customer_no"] },
        { fields: ["is_primary"] },
      ],
    },
  );

  return CustomerContact;
};
