"use strict";

/**
 * Imprest / direct-expense (DE) history — one row per posted directExpenses batch.
 * Mirrors totals and stores a JSON snapshot of line items for audit.
 */
module.exports = (sequelize, DataTypes) => {
  const Impress = sequelize.define(
    "Impress",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      /** Numeric ref from number generator (same as general_ledger.reference_number) */
      ref_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      /** Human-readable e.g. DE/26/123 */
      reference_display: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      user_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      transaction_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      remark: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mode_of_payment: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      cheque_number: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_expense: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
      },
      total_vat: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_payment: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
      },
      line_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      /** Snapshot of request data[] (and normalized amounts) */
      lines_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      /** Cash head / bank id / payment GL code snapshot */
      payment_meta_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "impress",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
      indexes: [
        { fields: ["facility_id", "ref_number"] },
        { fields: ["facility_id", "transaction_date"] },
      ],
    }
  );

  return Impress;
};
