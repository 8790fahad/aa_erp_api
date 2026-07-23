"use strict";
module.exports = (sequelize, DataTypes) => {
  const Account = sequelize.define(
    "Account",
    {
      head: {
        type: DataTypes.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      subhead: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      account_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      type_details: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      type_mnemonic: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      facilityId: {
        type: DataTypes.STRING(500),
        allowNull: false,
        primaryKey: true,
      },
      detail_type_mnemonic: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('activated', 'deactivated'),
        allowNull: false,
        defaultValue: 'activated',
      },
      show:{
        type: DataTypes.ENUM('true', 'false'),
        allowNull: false,
        defaultValue: 'true',
      },
      display: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      tableName: "account",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: false,
    }
  );

  Account.associate = function (models) {
    // Account belongs to Business
    if (models.Business) {
      Account.belongsTo(models.Business, {
        foreignKey: "facilityId",
        targetKey: "id",
      });
    }
  };

  return Account;
};
