"use strict";

/**
 * MixtureIngredient — line items belonging to a Mixture. Each row records a
 * single WIP raw-material that was consumed to produce the semi-finished good.
 */
module.exports = (sequelize, DataTypes) => {
  const MixtureIngredient = sequelize.define(
    "MixtureIngredient",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      mixture_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      product_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      product_sku: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      product_name: {
        type: DataTypes.STRING(255),
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
      unit_of_measure: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "mixture_ingredients",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  MixtureIngredient.associate = (models) => {
    if (models.Mixture) {
      MixtureIngredient.belongsTo(models.Mixture, {
        foreignKey: "mixture_id",
        as: "mixture",
      });
    }
  };

  return MixtureIngredient;
};
