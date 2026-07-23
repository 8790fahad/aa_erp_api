"use strict";
module.exports = (sequelize, DataTypes) => {
  const BankAccount = sequelize.define(
    "bank_account",
    {
      account_number: { type: DataTypes.STRING, allowNull: false },
      account_name: { type: DataTypes.STRING, allowNull: false },
      bank_code: { type: DataTypes.STRING, allowNull: false },
      account_bank_type: { type: DataTypes.STRING, allowNull: false },
      head: { type: DataTypes.STRING, allowNull: true },
      currency: { type: DataTypes.STRING, defaultValue: "NGN" },
      facilityId: { type: DataTypes.STRING, allowNull: false },
      payroll_template: { type: DataTypes.TEXT("long"), allowNull: true },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        // references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "bank_accounts",
      underscored: true,
      timestamps: true,
    }
  );

  return BankAccount;
};
