"use strict";
module.exports = (sequelize, DataTypes) => {
  const Performance = sequelize.define(
    "performance",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      employeeId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      period: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'e.g., "Q1-2024", "Annual-2024"',
      },
      periodType: {
        type: DataTypes.ENUM("Quarterly", "Annual", "Monthly"),
        allowNull: false,
      },
      kpiScores: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON object containing KPI scores",
      },
      overallRating: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5,
        },
      },
      selfRating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 1,
          max: 5,
        },
      },
      managerRating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 1,
          max: 5,
        },
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      managerComments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      goals: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON array of goals for the period",
      },
      achievements: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON array of achievements for the period",
      },
      improvementAreas: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON array of areas for improvement",
      },
      status: {
        type: DataTypes.ENUM(
          "Draft",
          "Self Review",
          "Manager Review",
          "Completed",
          "Cancelled"
        ),
        defaultValue: "Draft",
      },
      reviewedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        // references: {
        //   model: "users",
        //   key: "id",
        // },
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      promotionRecommendation: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      salaryAdjustmentRecommendation: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      tableName: "performance",
      timestamps: true,
    }
  );

  Performance.associate = (models) => {
    Performance.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      constraints: false,
    });

    Performance.belongsTo(models.users, {
      foreignKey: "reviewedBy",
      as: "reviewer",
      constraints: false,
    });
  };

  return Performance;
};

