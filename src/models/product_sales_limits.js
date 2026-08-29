"use strict";

module.exports = (sequelize, DataTypes) => {
  const ProductSalesLimit = sequelize.define(
    "ProductSalesLimit",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      sku: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      period: {
        type: DataTypes.ENUM("daily", "weekly", "monthly"),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "product_sales_limits",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["facility_id", "sku", "branch_id"],
          name: "product_sales_limits_facility_sku_branch",
        },
      ],
    },
  );

  return ProductSalesLimit;
};
