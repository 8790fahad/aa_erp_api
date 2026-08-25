"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CollectionReconciliation extends Model {}

  CollectionReconciliation.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      recon_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      cashier_user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      cashier_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      expected_cash: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expected_transfer: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expected_total: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_cash: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_transfer: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      received_total: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_cash: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_transfer: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      variance_total: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "draft",
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      confirmed_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      confirmed_by_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      confirmed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "CollectionReconciliation",
      tableName: "collection_reconciliations",
      timestamps: true,
      underscored: true,
    },
  );

  return CollectionReconciliation;
};
