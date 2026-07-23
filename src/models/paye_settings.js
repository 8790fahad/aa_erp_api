"use strict";

const { DEFAULT_TAX_BANDS_2026 } = require("../utils/paye2026");

module.exports = (sequelize, DataTypes) => {
  const PayeSettings = sequelize.define(
    "paye_settings",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      assessmentYear: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      rentReliefRate: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 20,
      },
      rentReliefCap: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 500000,
      },
      nhfRate: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 2.5,
      },
      nhfBase: {
        type: DataTypes.ENUM("gross", "basic", "bht", "taxable"),
        allowNull: false,
        defaultValue: "basic",
      },
      nhisRate: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 5,
      },
      nhisBase: {
        type: DataTypes.ENUM("gross", "basic", "bht", "taxable"),
        allowNull: false,
        defaultValue: "basic",
      },
      pensionRate: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 8,
      },
      pensionBase: {
        type: DataTypes.ENUM("gross", "basic", "bht", "taxable"),
        allowNull: false,
        defaultValue: "taxable",
      },
      taxBands: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: DEFAULT_TAX_BANDS_2026,
      },
      payeLedgerAccount: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Chart of account head for PAYE tax payable liability",
      },
      autoCalculation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
    },
    {
      tableName: "paye_settings",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["facilityId", "assessmentYear"],
        },
      ],
    }
  );

  return PayeSettings;
};
