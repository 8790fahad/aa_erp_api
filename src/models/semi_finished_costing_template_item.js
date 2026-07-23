"use strict";

module.exports = (sequelize, DataTypes) => {
  const SemiFinishedCostingTemplateItem = sequelize.define(
    "SemiFinishedCostingTemplateItem",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      template_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      line_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "raw_material",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      description_code: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      account_head: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      quantity: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 0,
      },
      raw_material_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      raw_material_name: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      raw_material_sku: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      other_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      rate: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      unit_cost: {
        type: DataTypes.DECIMAL(20, 6),
        allowNull: false,
        defaultValue: 0,
      },
      percentage_basis: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "semi_finished_costing_template_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  SemiFinishedCostingTemplateItem.associate = (models) => {
    if (models.SemiFinishedCostingTemplate) {
      SemiFinishedCostingTemplateItem.belongsTo(models.SemiFinishedCostingTemplate, {
        foreignKey: "template_id",
        as: "template",
      });
    }
  };

  return SemiFinishedCostingTemplateItem;
};
