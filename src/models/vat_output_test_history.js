"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class VatOutputTestHistory extends Model {}

  VatOutputTestHistory.init(
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
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      month: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      divisor: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      output_vat: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      invoice_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      selected_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      selected_codes: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      generated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      previewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "VatOutputTestHistory",
      tableName: "vat_output_test_history",
      timestamps: true,
      underscored: true,
      indexes: [
        {
          unique: true,
          name: "vat_output_test_history_facility_year_month",
          fields: ["facility_id", "year", "month"],
        },
      ],
    },
  );

  return VatOutputTestHistory;
};
