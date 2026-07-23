"use strict";

/**
 * Semi-finished costing templates: many per (facility, product), identified by template_name.
 * Line items are stored in semi_finished_costing_template_items.
 */
module.exports = (sequelize, DataTypes) => {
  const SemiFinishedCostingTemplate = sequelize.define(
    "SemiFinishedCostingTemplate",
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
      product_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      template_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "Default",
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      /** Legacy-format JSON: { kind, productId, createdBy, createdAt, items[] } (camelCase items) */
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "semi_finished_costing_templates",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  SemiFinishedCostingTemplate.associate = (models) => {
    if (models.SemiFinishedCostingTemplateItem) {
      SemiFinishedCostingTemplate.hasMany(
        models.SemiFinishedCostingTemplateItem,
        {
          foreignKey: "template_id",
          as: "items",
        },
      );
    }
    if (models.Product) {
      SemiFinishedCostingTemplate.belongsTo(models.Product, {
        foreignKey: "product_id",
        as: "product",
      });
    }
  };

  return SemiFinishedCostingTemplate;
};
