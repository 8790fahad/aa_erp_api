"use strict";

module.exports = (sequelize, DataTypes) => {
  const ProductSalesStop = sequelize.define(
    "ProductSalesStop",
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
    },
    {
      tableName: "product_sales_stops",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["facility_id", "sku", "branch_id"],
          name: "product_sales_stops_facility_sku_branch",
        },
      ],
    },
  );

  return ProductSalesStop;
};
