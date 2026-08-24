"use strict";

/**
 * Pending journal lines — posted to general_ledger only on approval.
 */
module.exports = (sequelize, DataTypes) => {
  const JournalDraftLine = sequelize.define(
    "JournalDraftLine",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      transaction_ref: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      line_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      account_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      account_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      line_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      line_description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      debit: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0,
      },
      credit: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0,
      },
      number_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      supplier_customer_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      supplier_customer_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      supplier_customer_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "aa_journal_draft_lines",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      freezeTableName: true,
    }
  );

  JournalDraftLine.associate = (models) => {
    if (models.JournalDraft) {
      JournalDraftLine.belongsTo(models.JournalDraft, {
        foreignKey: "transaction_ref",
        targetKey: "transaction_ref",
        as: "draft",
      });
    }
  };

  return JournalDraftLine;
};
