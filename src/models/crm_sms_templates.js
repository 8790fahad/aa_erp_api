"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmSmsTemplate extends Model {}

  CrmSmsTemplate.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      variables: { type: DataTypes.JSON, allowNull: true },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmSmsTemplate",
      tableName: "crm_sms_templates",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmSmsTemplate;
};
