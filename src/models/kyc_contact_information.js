"use strict";

/**
 * KYC contact person details — separate from account signup fields on kyc_users.
 */
module.exports = (sequelize, DataTypes) => {
  const KycContactInformation = sequelize.define(
    "KycContactInformation",
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
      title: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      first_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      last_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
    },
    {
      tableName: "kyc_contact_information",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycContactInformation.associate = (models) => {
    if (models.KycUser) {
      KycContactInformation.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasOne(models.KycContactInformation, {
        foreignKey: "kyc_user_id",
        as: "contactInformation",
      });
    }
  };

  return KycContactInformation;
};
