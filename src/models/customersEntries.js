"use strict";
module.exports = (sequelize, DataTypes) => {
  const CustomerEntry = sequelize.define(
    "CustomerEntry",
    {
      entry_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      customerNo: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING },
      qty_in: { type: DataTypes.FLOAT, defaultValue: 0 },
      qty_out: { type: DataTypes.FLOAT, defaultValue: 0 },
      bank_account_id: { type: DataTypes.STRING },
      cost: { type: DataTypes.FLOAT, defaultValue: 0 },
      // tax_type: { type: DataTypes.ENUM("inclusive", "exclusive") },
      facilityId: {
        type: DataTypes.STRING,
        collate: "utf8mb4_general_ci",
        references: {
          model: "business",
          key: "id",
        },
      },
      mode_of_payment: { type: DataTypes.STRING },
      receiptNo: { type: DataTypes.STRING },
      link_id: { type: DataTypes.STRING },
      branch_id: { type: DataTypes.INTEGER, allowNull: true },
      type: { type: DataTypes.ENUM("discount","pro-bono","service", "tax", "deposit", "purchase", "opening_balance") },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      tableName: "customer_entries",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      charset: "latin1", // ✅ set charset
      collate: "latin1_swedish_ci",
    }
  );

  CustomerEntry.associate = function (models) {
    // CustomerEntry belongs to Customer
    if (models.Customer) {
      CustomerEntry.belongsTo(models.Customer, {
        foreignKey: "customerNo",
        as: "customer",
      });
    }

    // CustomerEntry belongs to User (creator)
    if (models.User) {
      CustomerEntry.belongsTo(models.User, {
        foreignKey: "created_by",
        as: "creator",
      });
    }

    // CustomerEntry belongs to Business
    if (models.Business) {
      CustomerEntry.belongsTo(models.Business, {
        foreignKey: "facilityId",
        targetKey: "id",
        as: "business",
      });
    }
  };

  return CustomerEntry;
};
