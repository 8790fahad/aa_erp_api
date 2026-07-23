"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SuppliersInfo extends Model {
    static associate(models) {
      // Facility relationship
      if (models.Business) {
        SuppliersInfo.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "facility",
        });
      }

      // Supplier can have many products
      if (models.Product) {
        SuppliersInfo.hasMany(models.Product, {
          foreignKey: "supplier_id",
          as: "products",
        });
      }

      // Supplier can have many materials
      if (models.Material) {
        SuppliersInfo.hasMany(models.Material, {
          foreignKey: "supplier_id",
          as: "materials",
        });
      }

      // Supplier can have many payments
      if (models.SupplierPayment) {
        SuppliersInfo.hasMany(models.SupplierPayment, {
          foreignKey: "supplier_number",
          as: "payments",
        });
      }

      // Supplier can have many bank accounts
      if (models.BankAccount) {
        SuppliersInfo.hasMany(models.BankAccount, {
          foreignKey: "supplier_number",
          as: "bankAccounts",
        });
      }

      // Supplier can have many supplier accounts
      if (models.SupplierAccount) {
        SuppliersInfo.hasMany(models.SupplierAccount, {
          foreignKey: "supplier_number",
          as: "accounts",
        });
      }

      // Supplier can have many supplier entries
      if (models.SupplierEntry) {
        SuppliersInfo.hasMany(models.SupplierEntry, {
          foreignKey: "supplier_number",
          as: "entries",
        });
      }

      // Supplier can have many purchase orders
      if (models.PurchaseOrder) {
        SuppliersInfo.hasMany(models.PurchaseOrder, {
          foreignKey: "supplier_number",
          as: "purchaseOrders",
        });
      }

      if (models.SupplierContact) {
        SuppliersInfo.hasMany(models.SupplierContact, {
          foreignKey: "supplier_number",
          sourceKey: "supplier_number",
          constraints: false,
          as: "contacts",
        });
      }

      if (models.SupplierAddress) {
        SuppliersInfo.hasMany(models.SupplierAddress, {
          foreignKey: "supplier_number",
          sourceKey: "supplier_number",
          constraints: false,
          as: "addresses",
        });
      }
    }
  }

  SuppliersInfo.init(
    {
      facilityId: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false,
      },
      supplier_number: {
        type: DataTypes.STRING(10),
        primaryKey: true,
        allowNull: false,
      },
      supplier_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      company_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
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
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      balance:{
        type:DataTypes.DECIMAL(20, 2),
        allowNull: true,
      },
      address: DataTypes.STRING(250),
      phone: DataTypes.STRING(20),
      mobile: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: "active",
        validate: { isIn: [["active", "inactive", "suspended"]] },
      },
      email: {
        type: DataTypes.STRING(50),
        validate: { isEmail: true },
      },
      tin: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      language: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      payment_terms: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      payable_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      payable_accural_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // other_payable_code: {
      //   type: DataTypes.STRING(50),
      //   allowNull: true,
      // },
    },
    {
      sequelize,
      modelName: "SuppliersInfo",
      tableName: "suppliersinfo",
      timestamps: false,
      indexes: [
        { unique: true, fields: ["facilityId", "supplier_number"] },
        { fields: ["supplier_name"] },
        { fields: ["status"] },
        { fields: ["email"] },
      ],
    }
  );

  return SuppliersInfo;
};
