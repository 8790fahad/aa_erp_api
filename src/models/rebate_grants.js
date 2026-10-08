"use strict";

module.exports = (sequelize, DataTypes) => {
  const RebateGrant = sequelize.define(
    "RebateGrant",
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
      basis: {
        type: DataTypes.ENUM("sales", "purchase"),
        allowNull: false,
        defaultValue: "sales",
      },
      party_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      party_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
      },
      note: {
        type: DataTypes.STRING(500),
        allowNull: true,
        defaultValue: null,
      },
      grant_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "paid"),
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
      mode_of_payment: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: null,
      },
      payment_reference: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      bank_account_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
      cheque_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
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
      tableName: "rebate_grants",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["facility_id"], name: "idx_rebate_grants_facility" },
      ],
    },
  );

  return RebateGrant;
};
