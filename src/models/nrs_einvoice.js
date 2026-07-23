"use strict";

/**
 * NRS / FIRS e-invoice submissions accepted by FlowBooks (SI sandbox + APP queue).
 * Persisted so status/payment work across cluster workers.
 */
module.exports = (sequelize, DataTypes) => {
  const NrsEInvoice = sequelize.define(
    "NrsEInvoice",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      business_id: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      irn: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      invoice_kind: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      payment_status: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "PENDING",
      },
      clearance_status: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "ACCEPTED",
      },
      transmission_status: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "QUEUED",
      },
      qr_code: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reference: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
        // mysql2 sometimes returns JSON columns as strings; always expose objects.
        get() {
          const raw = this.getDataValue("payload");
          if (raw == null || typeof raw === "object") return raw;
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw);
            } catch {
              return raw;
            }
          }
          return raw;
        },
      },
      upstream: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const raw = this.getDataValue("upstream");
          if (raw == null || typeof raw === "object") return raw;
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw);
            } catch {
              return raw;
            }
          }
          return raw;
        },
      },
    },
    {
      tableName: "nrs_einvoices",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["business_id", "irn"],
          name: "nrs_einvoices_business_irn",
        },
      ],
    },
  );

  return NrsEInvoice;
};
