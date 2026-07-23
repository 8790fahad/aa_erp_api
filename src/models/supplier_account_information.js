"use strict";
module.exports = (sequelize, DataTypes) => {
  const SupplierAccount = sequelize.define(
    "SupplierAccount",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      supplier_number: { type: DataTypes.STRING },
      account_name: { type: DataTypes.STRING },
      account_number: { type: DataTypes.STRING },
      bank_name: { type: DataTypes.STRING },
      status: { type: DataTypes.STRING },
      facilityId: { type: DataTypes.STRING },
    },
    { tableName: "supplier_account_information", timestamps: false }
  );

  SupplierAccount.associate = function (models) {
    // SupplierAccount belongs to Supplier
    if (models.SuppliersInfo) {
      SupplierAccount.belongsTo(models.SuppliersInfo, {
        foreignKey: "supplier_number",
        as: "supplier",
      });
    }
  };

  return SupplierAccount;
};
