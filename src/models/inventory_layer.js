"use strict";
module.exports = (sequelize, DataTypes) => {
  const InventoryLayer = sequelize.define(
    "InventoryLayer",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      facilityId: { type: DataTypes.STRING(50), allowNull: false },
      itemId: { type: DataTypes.STRING(60), allowNull: false },
      qty: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      unitCost: { type: DataTypes.DECIMAL(18, 6), defaultValue: 0 },
    },
    { tableName: "inv_layers", timestamps: true }
  );
  return InventoryLayer;
};








