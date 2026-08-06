"use strict";

module.exports = (sequelize, DataTypes) => {
  const CreditNoteApplication = sequelize.define(
    "CreditNoteApplication",
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      credit_note_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      invoice_ref: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "credit_note_applications",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          fields: ["facility_id", "credit_note_number"],
          name: "idx_cn_app_facility_cn",
        },
        {
          fields: ["facility_id", "invoice_ref"],
          name: "idx_cn_app_facility_inv",
        },
      ],
    },
  );

  return CreditNoteApplication;
};
