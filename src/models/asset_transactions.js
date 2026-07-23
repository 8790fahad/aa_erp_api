"use strict";

module.exports = (sequelize, DataTypes) => {
  const AssetTransaction = sequelize.define(
    "asset_transactions",
    {
      id: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      assetId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      transactionType: {
        type: DataTypes.ENUM(
          'Acquisition',
          'Disposal',
          'Revaluation',
          'Impairment',
          'Transfer',
          'Maintenance',
          'Depreciation'
        ),
        allowNull: false,
      },
      transactionDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      referenceNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // For disposal transactions
      disposalMethod: {
        type: DataTypes.ENUM('Sale', 'Scrap', 'Trade-in', 'Donation', 'Loss'),
        allowNull: true,
      },
      disposalProceeds: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
      },
      // For revaluation transactions
      revaluationBasis: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      revaluationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // For transfer transactions
      fromLocation: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      toLocation: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      fromCustodian: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      toCustodian: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      fromDepartment: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      toDepartment: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Accounting integration
      journalEntryId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Reference to general ledger entry',
      },
      accountingPeriod: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      facilityId: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      createdBy: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      approvedBy: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('Pending', 'Approved', 'Rejected'),
        allowNull: false,
        defaultValue: 'Pending',
      },
    },
    {
      timestamps: true,
      indexes: [
        {
          fields: ['assetId'],
        },
        {
          fields: ['facilityId'],
        },
        {
          fields: ['transactionType'],
        },
        {
          fields: ['transactionDate'],
        },
        {
          fields: ['status'],
        },
      ],
    }
  );

  // Associations
  AssetTransaction.associate = (models) => {
    // AssetTransaction.belongsTo(models.assets, {
    //   foreignKey: 'assetId',
    //   as: 'asset',
    // });
    
    // AssetTransaction.belongsTo(models.users, {
    //   foreignKey: 'createdBy',
    //   as: 'creator',
    // });
    
    // AssetTransaction.belongsTo(models.users, {
    //   foreignKey: 'approvedBy',
    //   as: 'approver',
    // });
  };

  return AssetTransaction;
};