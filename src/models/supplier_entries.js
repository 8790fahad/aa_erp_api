"use strict";
module.exports = (sequelize, DataTypes) => {
  const SupplierEntry = sequelize.define(
    "SupplierEntry",
    {
      entry_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      supplier_number: { type: DataTypes.STRING, allowNull: false },
      receiptNo: { type: DataTypes.STRING },
      description: { type: DataTypes.STRING },
      qty_in: { type: DataTypes.FLOAT, defaultValue: 0 },
      qty_out: { type: DataTypes.FLOAT, defaultValue: 0 },
      cost: { type: DataTypes.FLOAT, defaultValue: 0 },
      bank_account_id: { type: DataTypes.STRING },
      transaction_date: { type: DataTypes.DATE },
      facilityId: {
        type: DataTypes.STRING,
        collate: "utf8mb4_general_ci",
        references: {
          model: "business",
          key: "id",
        },
      },
      mode_of_payment: { type: DataTypes.STRING },
      cheque_no: { type: DataTypes.STRING },
      type: { type: DataTypes.ENUM("discount","service", "tax", "payment", "purchase", "opening_balance") },
      link_id: { type: DataTypes.STRING },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      tableName: "supplier_entries",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      charset: "latin1", // ✅ set charset
      collate: "latin1_swedish_ci",
    }
  );

  SupplierEntry.associate = function (models) {
    // SupplierEntry belongs to Supplier
    if (models.SuppliersInfo) {
      SupplierEntry.belongsTo(models.SuppliersInfo, {
        foreignKey: "supplier_number",
        as: "supplier",
      });
    }

    // SupplierEntry belongs to User (creator)
    if (models.User) {
      SupplierEntry.belongsTo(models.User, {
        foreignKey: "created_by",
        as: "creator",
      });
    }

    // SupplierEntry belongs to Business
    if (models.Business) {
      SupplierEntry.belongsTo(models.Business, {
        foreignKey: "facilityId",
        targetKey: "id",
        as: "business",
      });
    }
  };

  return SupplierEntry;
};
