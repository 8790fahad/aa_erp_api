"use strict";
module.exports = (sequelize, DataTypes) => {
  const BankMatchingRule = sequelize.define(
    "bank_matching_rule",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      priority: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        allowNull: false,
      },
      threshold: {
        type: DataTypes.DECIMAL(3, 2),
        defaultValue: 0.7,
        allowNull: false,
      },
      auto_approve: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      conditions: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },
    },
    {
      tableName: "bank_matching_rules",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  BankMatchingRule.associate = function (models) {
    // Add associations if needed in the future
  };

  return BankMatchingRule;
};
