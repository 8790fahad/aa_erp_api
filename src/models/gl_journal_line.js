"use strict";
module.exports = (sequelize, DataTypes) => {
  const GLJournalLine = sequelize.define(
    "GLJournalLine",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      batchId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      lineNo: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      accountId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      debit: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0,
      },
      credit: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0,
      },
      costCenter: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      productLine: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      taxCode: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      partyId: {
        // customerId or vendorId depending on partyType
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      partyType: {
        // 'customer' | 'vendor' | null
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      sourceId: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      sourceLineId: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
    },
    {
      tableName: "gl_journal_lines",
      timestamps: true,
    }
  );

  GLJournalLine.associate = (models) => {
    GLJournalLine.belongsTo(models.GLJournalBatch, {
      as: "batch",
      foreignKey: "batchId",
    });
  };

  return GLJournalLine;
};
