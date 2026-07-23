"use strict";
module.exports = (sequelize, DataTypes) => {
  const BillOfMaterialItem = sequelize.define(
    "bill_of_material_items",
    {
      id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      bom_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // references: {
        //   model: "bill_of_materials",
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
      quantity_required: {
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
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
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
      tableName: "bill_of_material_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BillOfMaterialItem.associate = (models) => {
    // Associate with bill_of_materials table
    BillOfMaterialItem.belongsTo(models.BillOfMaterial, {
      foreignKey: "bom_id",
      as: "billOfMaterial",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });

    // Associate with materials table
    BillOfMaterialItem.belongsTo(models.Material, {
      foreignKey: "material_id",
      as: "material",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });
  };

  return BillOfMaterialItem;
};



