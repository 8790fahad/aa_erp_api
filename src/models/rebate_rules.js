"use strict";

module.exports = (sequelize, DataTypes) => {
  const RebateRule = sequelize.define(
    "RebateRule",
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
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      basis: {
        type: DataTypes.ENUM("sales", "purchase"),
        allowNull: false,
        defaultValue: "sales",
      },
      target_type: {
        type: DataTypes.ENUM("product", "supplier", "customer"),
        allowNull: false,
        defaultValue: "product",
      },
      product_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "All products",
      },
      product_sku: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      supplier_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      supplier_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },
      customer_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      customer_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null,
      },
      period_label: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      from_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      to_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      min_qty: {
        type: DataTypes.DECIMAL(20, 4),
        allowNull: false,
        defaultValue: 0,
      },
      rebate_percent: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "rebate_rules",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["facility_id"], name: "idx_rebate_rules_facility" },
        {
          fields: ["facility_id", "from_date", "to_date"],
          name: "idx_rebate_rules_period",
        },
      ],
    },
  );

  RebateRule.associate = (models) => {
    if (models.RebateStatus) {
      RebateRule.hasMany(models.RebateStatus, {
        foreignKey: "rule_id",
        as: "statuses",
        onDelete: "CASCADE",
      });
    }
  };

  return RebateRule;
};
