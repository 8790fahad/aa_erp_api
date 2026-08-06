"use strict";

module.exports = (sequelize, DataTypes) => {
  const ActivityAudit = sequelize.define(
    "activity_audit",
    {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      entity_type: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      entity_label: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      before_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      after_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      remark: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "activity_audits",
      timestamps: false,
      underscored: true,
      freezeTableName: true,
    },
  );

  return ActivityAudit;
};
