"use strict";

/**
 * E-Invoicing API client credentials.
 *
 * Supports one credential pair per (owner, environment):
 * - KYC clients: keyed by kyc_user_id + environment (testing | production)
 * - FlowBooks businesses: keyed by business_id + environment
 *
 * Stores public `client_id` and a bcrypt hash of `client_secret`.
 * Plaintext secret is returned only once (create/rotate) and never persisted.
 */
module.exports = (sequelize, DataTypes) => {
  const EInvoicingClient = sequelize.define(
    "EInvoicingClient",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      business_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "FlowBooks business/facility id (optional until linked)",
      },
      kyc_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "KYC client that owns this credential pair",
      },
      environment: {
        type: DataTypes.ENUM("testing", "production"),
        allowNull: false,
        defaultValue: "production",
        comment: "Sandbox/testing vs live/production credentials",
      },
      client_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: "Public OAuth client identifier",
      },
      client_secret_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "bcrypt hash of the client secret (plaintext never stored)",
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: true,
        comment: "Optional label for the credential",
      },
      status: {
        type: DataTypes.ENUM("active", "revoked"),
        allowNull: false,
        defaultValue: "active",
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "einvoicing_clients",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    },
  );

  EInvoicingClient.associate = (models) => {
    if (models.KycUser) {
      EInvoicingClient.belongsTo(models.KycUser, {
        foreignKey: "kyc_user_id",
        as: "kycUser",
      });
    }
  };

  return EInvoicingClient;
};
