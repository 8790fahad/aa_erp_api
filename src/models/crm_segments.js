"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmSegment extends Model {}

  CrmSegment.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      segment_key: { type: DataTypes.STRING(100), allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_builtin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      filters: { type: DataTypes.JSON, allowNull: true },
      created_by: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmSegment",
      tableName: "crm_segments",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmSegment;
};
