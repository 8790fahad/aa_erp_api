"use strict";

/**
 * KYC terms & conditions acceptance for Get Started.
 */
module.exports = (sequelize, DataTypes) => {
  const KycTermsAcceptance = sequelize.define(
    "KycTermsAcceptance",
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
      terms_version: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      accepted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      accepted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      accepted_ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: "kyc_terms_acceptance",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycTermsAcceptance.associate = (models) => {
    if (models.KycUser) {
      KycTermsAcceptance.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasOne(KycTermsAcceptance, {
        foreignKey: "kyc_user_id",
        as: "termsAcceptance",
      });
    }
  };

  return KycTermsAcceptance;
};
