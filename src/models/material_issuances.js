"use strict";
module.exports = (sequelize, DataTypes) => {
  const MaterialIssuance = sequelize.define(
    "material_issuances",
    {
      id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      facility_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      production_order_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // references: {
        //   model: "production_orders",
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
      quantity_issued: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      unit_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      issued_by: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      issued_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      tableName: "material_issuances",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  MaterialIssuance.associate = (models) => {
    // Associate with production_orders table
    MaterialIssuance.belongsTo(models.ProductionOrder, {
      foreignKey: "production_order_id",
      as: "productionOrder",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });

    // Associate with materials table
    MaterialIssuance.belongsTo(models.Material, {
      foreignKey: "material_id",
      as: "material",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });
  };

  return MaterialIssuance;
};



