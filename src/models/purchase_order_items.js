"use strict";
module.exports = (sequelize, DataTypes) => {
  const PurchaseOrderItem = sequelize.define(
    "purchase_order_items",
    {
      id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      po_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // references: {
        //   model: "purchase_orders",
        //   key: "id",
        // },
      },
      material_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // references: {
        //   model: "materials",
        //   key: "id",
        // },
      },
      quantity: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      unit_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_price: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "purchase_order_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  PurchaseOrderItem.associate = (models) => {
    // Associate with purchase_orders table
    PurchaseOrderItem.belongsTo(models.PurchaseOrder, {
      foreignKey: "po_id",
      as: "purchaseOrder",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });

    // Associate with materials table
    PurchaseOrderItem.belongsTo(models.Material, {
      foreignKey: "material_id",
      as: "material",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });
  };

  return PurchaseOrderItem;
};



