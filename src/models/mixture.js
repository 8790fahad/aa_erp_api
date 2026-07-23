"use strict";

/**
 * Mixture model — records a "mixture" production run that consumes one or
 * more WIP raw-material items and produces a semi-finished good.
 *
 * One Mixture has many MixtureIngredient rows (the materials consumed).
 *
 * The corresponding inventory movement and journal entries are written
 * separately to `store_entries` and `general_ledger` by the controller.
 */
module.exports = (sequelize, DataTypes) => {
  const Mixture = sequelize.define(
    "Mixture",
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
        unique: true,
      },
      // Semi-finished product produced
      product_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      product_sku: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      product_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      quantity_produced: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      unit_of_measure: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_ingredients_cost: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      unit_cost: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      // Account codes used for the GL posting
      inventory_account: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      wip_account: {
        type: DataTypes.STRING(50),
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
      tableName: "mixtures",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  Mixture.associate = (models) => {
    if (models.MixtureIngredient) {
      Mixture.hasMany(models.MixtureIngredient, {
        foreignKey: "mixture_id",
        as: "ingredients",
      });
    }
  };

  return Mixture;
};
