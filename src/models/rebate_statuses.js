"use strict";

module.exports = (sequelize, DataTypes) => {
  const RebateStatus = sequelize.define(
    "RebateStatus",
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      rule_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      customer_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      customer_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "paid"),
        allowNull: false,
        defaultValue: "pending",
      },
      payout_type: {
        type: DataTypes.ENUM("credit", "cash"),
        allowNull: false,
        defaultValue: "credit",
      },
      credit_note_number: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      updated_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "rebate_statuses",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["facility_id", "rule_id", "customer_name"],
          name: "uq_rebate_status_customer_rule",
        },
        { fields: ["facility_id"], name: "idx_rebate_statuses_facility" },
        { fields: ["rule_id"], name: "idx_rebate_statuses_rule" },
      ],
    },
  );

  RebateStatus.associate = (models) => {
    if (models.RebateRule) {
      RebateStatus.belongsTo(models.RebateRule, {
        foreignKey: "rule_id",
        as: "rule",
        onDelete: "CASCADE",
      });
    }
  };

  return RebateStatus;
};
