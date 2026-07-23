"use strict";

/**
 * KYC uploaded registration documents (CAC certificate, MoA, proof of address, etc.).
 */
module.exports = (sequelize, DataTypes) => {
  const KycBusinessDocument = sequelize.define(
    "KycBusinessDocument",
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
      doc_type: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      file_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      file_url: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      mime_type: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      file_size: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      storage_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: "Local path under public/uploads for deletion",
      },
    },
    {
      tableName: "kyc_business_documents",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  KycBusinessDocument.associate = (models) => {
    if (models.KycUser) {
      KycBusinessDocument.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
      models.KycUser.hasMany(KycBusinessDocument, {
        foreignKey: "kyc_user_id",
        as: "businessDocuments",
      });
    }
  };

  return KycBusinessDocument;
};
