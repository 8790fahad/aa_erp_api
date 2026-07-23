"use strict";
module.exports = (sequelize, DataTypes) => {
  const GLJournalBatch = sequelize.define(
    "GLJournalBatch",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      facilityId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      periodId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      docNo: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      docType: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      docDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      fxRate: {
        type: DataTypes.DECIMAL(18, 6),
        allowNull: true,
      },
      status: {
        // draft, posted, reversed
        type: DataTypes.ENUM("draft", "posted", "reversed"),
        allowNull: false,
        defaultValue: "draft",
      },
      idempotencyKey: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
      },
      sourceModule: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      postedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      locked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: "gl_journal_batches",
      timestamps: true,
      indexes: [{ unique: true, fields: ["idempotencyKey"] }],
    }
  );

  GLJournalBatch.associate = (models) => {
    GLJournalBatch.hasMany(models.GLJournalLine, {
      as: "lines",
      foreignKey: "batchId",
    });
  };

  return GLJournalBatch;
};






