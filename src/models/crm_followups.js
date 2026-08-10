"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmFollowup extends Model {}

  CrmFollowup.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      customer_no: { type: DataTypes.STRING(50), allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      due_at: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.ENUM("pending", "done", "cancelled", "overdue"),
        allowNull: false,
        defaultValue: "pending",
      },
      assigned_user_id: { type: DataTypes.STRING(50), allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmFollowup",
      tableName: "crm_followups",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmFollowup;
};
