"use strict";

/**
 * KYC business profile — legal/trading details for Get Started registration + brand info.
 */
module.exports = (sequelize, DataTypes) => {
  const KycBusinessInformation = sequelize.define(
    "KycBusinessInformation",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      kyc_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      legal_name: { type: DataTypes.STRING(255), allowNull: true },
      trading_name: { type: DataTypes.STRING(255), allowNull: true },
      business_type: { type: DataTypes.STRING(80), allowNull: true },
      registration_number: { type: DataTypes.STRING(80), allowNull: true },
      tin: { type: DataTypes.STRING(80), allowNull: true },
      address_line1: { type: DataTypes.STRING(255), allowNull: true },
      address_line2: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(120), allowNull: true },
      state: { type: DataTypes.STRING(120), allowNull: true },
      country: { type: DataTypes.STRING(2), allowNull: true, defaultValue: "NG" },
      postal_code: { type: DataTypes.STRING(40), allowNull: true },
      industry: { type: DataTypes.STRING(255), allowNull: true },
      website: { type: DataTypes.STRING(255), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "kyc_business_information",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycBusinessInformation.associate = (models) => {
    if (models.KycUser) {
      KycBusinessInformation.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasOne(KycBusinessInformation, {
        foreignKey: "kyc_user_id",
        as: "businessInformation",
      });
    }
  };

  return KycBusinessInformation;
};
