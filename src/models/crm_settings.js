"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmSettings extends Model {}

  CrmSettings.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      dormant_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 90 },
      inactive_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 180 },
      lost_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 365 },
      vip_min_sales: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 1000000,
      },
      regular_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      active_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    },
    {
      sequelize,
      modelName: "CrmSettings",
      tableName: "crm_settings",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmSettings;
};
