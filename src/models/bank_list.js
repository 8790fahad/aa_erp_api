"use strict";

/**
 * Nigerian bank directory per facility (matches `bank_list` table).
 * Composite primary key: bank_code + bank_cbn_code + facilityId
 */
module.exports = (sequelize, DataTypes) => {
  const BankList = sequelize.define(
    "BankList",
    {
      bank_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      bank_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
      },
      bank_cbn_code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        primaryKey: true,
      },
      facilityId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        primaryKey: true,
        field: "facilityId",
      },
    },
    {
      tableName: "bank_list",
      timestamps: false,
    }
  );

  return BankList;
};
