"use strict";
module.exports = (sequelize, DataTypes) => {
  const InventoryItem = sequelize.define(
    "InventoryItem",
    {
      id: { type: DataTypes.STRING(60), primaryKey: true },
      facilityId: { type: DataTypes.STRING(50), allowNull: false },
      name: { type: DataTypes.STRING(120), allowNull: false },
      costingMethod: {
        type: DataTypes.ENUM("weighted_average", "fifo"),
        defaultValue: "weighted_average",
      },
      inventoryAccountId: { type: DataTypes.STRING(50), allowNull: false },
      cogsAccountId: { type: DataTypes.STRING(50), allowNull: false },
      expenseVarianceAccountId: { type: DataTypes.STRING(50), allowNull: true },
      active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    { tableName: "inv_items", timestamps: true }
  );
  return InventoryItem;
};








