"use strict";

/**
 * Per-KYC-user integration settings (NRS IDs, etc.) keyed by service.
 */
module.exports = (sequelize, DataTypes) => {
  const KycServiceSettings = sequelize.define(
    "KycServiceSettings",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      kyc_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      service: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "e_invoice",
      },
      nrs_business_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      nrs_service_id: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
    },
    {
      tableName: "kyc_service_settings",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycServiceSettings.associate = (models) => {
    if (models.KycUser) {
      KycServiceSettings.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasMany(models.KycServiceSettings, {
        foreignKey: "kyc_user_id",
        as: "serviceSettings",
      });
    }
  };

  return KycServiceSettings;
};
