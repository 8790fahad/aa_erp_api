"use strict";

module.exports = (sequelize, DataTypes) => {
  const AssetMaintenance = sequelize.define(
    "asset_maintenance",
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
      maintenanceType: {
        type: DataTypes.ENUM(
          "Preventive",
          "Corrective",
          "Emergency",
          "Routine",
          "Overhaul"
        ),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      scheduledDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      actualDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      vendor: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      technician: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          "Scheduled",
          "In Progress",
          "Completed",
          "Cancelled",
          "Overdue"
        ),
        allowNull: false,
        defaultValue: "Scheduled",
      },
      priority: {
        type: DataTypes.ENUM("Low", "Medium", "High", "Critical"),
        allowNull: false,
        defaultValue: "Medium",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      nextMaintenanceDate: {
        type: DataTypes.DATEONLY,
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
    },
    {
      timestamps: true,
      indexes: [
        {
          fields: ["assetId"],
        },
        {
          fields: ["facilityId"],
        },
        {
          fields: ["status"],
        },
        {
          fields: ["scheduledDate"],
        },
        {
          fields: ["priority"],
        },
      ],
    }
  );

  // Associations
  AssetMaintenance.associate = (models) => {
    // AssetMaintenance.belongsTo(models.assets, {
    //   foreignKey: 'assetId',
    //   as: 'asset',
    // });
    // AssetMaintenance.belongsTo(models.users, {
    //   foreignKey: 'createdBy',
    //   as: 'creator',
    // });
  };

  return AssetMaintenance;
};
