"use strict";

/**
 * KYC signups — accounts registered through the AA ERP KYC app.
 *
 * Fully self-contained: password + email verification live here.
 * Do NOT use the main AA ERP `users` table for KYC auth.
 */
module.exports = (sequelize, DataTypes) => {
  const KycUser = sequelize.define(
    "KycUser",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Optional later link to a AA ERP business (not set at KYC signup)",
      },
      business_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(2),
        allowNull: true,
        defaultValue: "NG",
      },
      first_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      last_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true,
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "bcrypt hash — KYC credentials only",
      },
      verification_token: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      verification_expires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reset_token: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: "Password reset token (email link)",
      },
      reset_expires: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Expiry for reset_token",
      },
      email_verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      phone_verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Set true after signup SMS OTP is confirmed",
      },
      phone_code: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "Signup phone OTP (sha256 hex hash)",
      },
      phone_code_expires: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Expiry for phone_code",
      },
      code: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "Login OTP (sha256 hex hash)",
      },
      expiring_code: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Expiry timestamp for login OTP in code",
      },
      status: {
        type: DataTypes.ENUM("pending", "verified", "approved", "suspended"),
        allowNull: false,
        defaultValue: "pending",
      },
      kyc_submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "When the client submitted KYC details for admin review",
      },
    },
    {
      tableName: "kyc_users",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  return KycUser;
};
