"use strict";
module.exports = (sequelize, DataTypes) => {
  const InventoryGRNI = sequelize.define(
    "InventoryGRNI",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      facilityId: { type: DataTypes.STRING(50), allowNull: false },
      poNo: { type: DataTypes.STRING(60), allowNull: true },
      grnNo: { type: DataTypes.STRING(60), allowNull: false },
      vendorId: { type: DataTypes.STRING(60), allowNull: false },
      itemId: { type: DataTypes.STRING(60), allowNull: false },
      qty: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      unitCost: { type: DataTypes.DECIMAL(18, 6), defaultValue: 0 },
      matchedInvoiceNo: { type: DataTypes.STRING(60), allowNull: true },
      status: { type: DataTypes.ENUM("open", "matched"), defaultValue: "open" },
    },
    { tableName: "inv_grni", timestamps: true }
  );
  return InventoryGRNI;
};





