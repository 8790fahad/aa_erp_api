"use strict";

/**
 * KYC business stakeholders / shareholders linked to a KYC user.
 */
module.exports = (sequelize, DataTypes) => {
  const KycStakeholder = sequelize.define(
    "KycStakeholder",
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
      first_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      last_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      gender: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      date_of_birth: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      bvn: {
        type: DataTypes.STRING(90),
        allowNull: false,
        comment: "SHA-256 encoded BVN with last-four suffix for masking; full BVN is not stored.",
      },
    },
    {
      tableName: "kyc_stakeholders",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycStakeholder.associate = (models) => {
    if (models.KycUser) {
      KycStakeholder.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasMany(models.KycStakeholder, {
        foreignKey: "kyc_user_id",
        as: "stakeholders",
      });
    }
  };

  return KycStakeholder;
};
