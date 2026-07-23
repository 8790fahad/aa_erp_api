"use strict";

module.exports = (sequelize, DataTypes) => {
  const WipActionHistory = sequelize.define(
    "WipActionHistory",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      reference_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      product_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      product_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      action_type: {
        type: DataTypes.ENUM("return_raw_material", "write_off"),
        allowNull: false,
      },
      quantity: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      unit_cost: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      total_cost: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      source_location: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      destination_location: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
    },
    {
      tableName: "wip_action_history",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      underscored: true,
    }
  );

  return WipActionHistory;
};
