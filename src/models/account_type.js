"use strict";

module.exports = (sequelize, DataTypes) => {
  const AccountType = sequelize.define(
    "AccountType",
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: "Level 2 type code e.g. 101, 102, 201",
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      detail: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      accountNature: {
        type: DataTypes.ENUM(
          "ASSET",
          "LIABILITY",
          "EQUITY",
          "REVENUE",
          "EXPENSE"
        ),
        allowNull: false,
        field: "account_nature",
      },
      normalBalance: {
        type: DataTypes.ENUM("DEBIT", "CREDIT"),
        allowNull: false,
        defaultValue: "DEBIT",
        field: "normal_balance",
      },
      fsSection: {
        type: DataTypes.ENUM("BS", "PL"),
        allowNull: false,
        defaultValue: "BS",
        field: "fs_section",
      },
      facilityId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: "facility_id",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "is_active",
      },
    },
    {
      tableName: "account_type",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["code"], name: "account_type_code" },
        { fields: ["category"], name: "account_type_category" },
        { fields: ["type"], name: "account_type_type" },
        { fields: ["facility_id"], name: "account_type_facility_id" },
      ],
    }
  );

  AccountType.associate = function (models) {
    if (models.Business) {
      AccountType.belongsTo(models.Business, {
        foreignKey: "facilityId",
        as: "facility",
      });
    }
  };

  return AccountType;
};
