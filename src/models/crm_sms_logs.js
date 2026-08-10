"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmSmsLog extends Model {}

  CrmSmsLog.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      customer_no: { type: DataTypes.STRING(50), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      template_id: { type: DataTypes.INTEGER, allowNull: true },
      status: {
        type: DataTypes.ENUM("queued", "sent", "failed"),
        allowNull: false,
        defaultValue: "queued",
      },
      provider_response: { type: DataTypes.TEXT, allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      sent_by: { type: DataTypes.STRING(50), allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmSmsLog",
      tableName: "crm_sms_logs",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmSmsLog;
};
