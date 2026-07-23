"use strict";

module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define(
    "Sale",
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      productId: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
      },
      customerId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
      },
      price: {
        type: DataTypes.FLOAT.UNSIGNED,
        allowNull: false,
      },
      total: {
        type: DataTypes.FLOAT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      saleDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      status: {
        type: DataTypes.ENUM("completed", "pending", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
    },
    {
      tableName: "sales",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    }
  );

  Sale.associate = function (models) {
    // Sale belongs to Product
    if (models.Product) {
      Sale.belongsTo(models.Product, {
        foreignKey: "productId",
        targetKey: "id",
      });
    }

    // Sale belongs to Customer
    if (models.Customer) {
      Sale.belongsTo(models.Customer, {
        foreignKey: "customerId",
        targetKey: "customerNo",
      });
    }
  };

  // Hook to calculate total before create
  Sale.beforeCreate((sale) => {
    sale.total = sale.quantity * sale.price;
  });

  return Sale;
};
