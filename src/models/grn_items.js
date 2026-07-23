"use strict";
module.exports = (sequelize, DataTypes) => {
  const GRNItem = sequelize.define(
    "grn_items",
    {
      id: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      grn_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // references: {
        //   model: "goods_received_notes",
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
      quantity_received: {
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
      tableName: "grn_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  GRNItem.associate = (models) => {
    // Associate with goods_received_notes table
    GRNItem.belongsTo(models.GoodsReceivedNote, {
      foreignKey: "grn_id",
      as: "grn",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });

    // Associate with materials table
    GRNItem.belongsTo(models.Material, {
      foreignKey: "material_id",
      as: "material",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });
  };

  return GRNItem;
};



