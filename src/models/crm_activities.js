"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmActivity extends Model {}

  CrmActivity.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      customer_no: { type: DataTypes.STRING(50), allowNull: false },
      activity_type: {
        type: DataTypes.ENUM(
          "call",
          "meeting",
          "note",
          "task",
          "sms",
          "email",
          "other",
        ),
        allowNull: false,
        defaultValue: "note",
      },
      subject: { type: DataTypes.STRING(255), allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "completed",
      },
      due_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmActivity",
      tableName: "crm_activities",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmActivity;
};
