"use strict";

/**
 * Pending journal headers — not in general_ledger until approved.
 */
module.exports = (sequelize, DataTypes) => {
  const JournalDraft = sequelize.define(
    "JournalDraft",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      transaction_ref: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      reference_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      entry_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: "NGN",
      },
      exchange_rate: {
        type: DataTypes.DECIMAL(18, 6),
        defaultValue: 1,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      total_debit: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0,
      },
      total_credit: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: "draft",
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      approved_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "aa_journal_drafts",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      freezeTableName: true,
    }
  );

  JournalDraft.associate = (models) => {
    if (models.JournalDraftLine) {
      JournalDraft.hasMany(models.JournalDraftLine, {
        foreignKey: "transaction_ref",
        sourceKey: "transaction_ref",
        as: "lines",
      });
    }
  };

  return JournalDraft;
};
