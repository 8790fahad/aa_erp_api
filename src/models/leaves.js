"use strict";
module.exports = (sequelize, DataTypes) => {
  const Leave = sequelize.define(
    "leaves",
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
      leaveType: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      startDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      originalEndDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      earlyReturnDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      earlyReturnReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      totalDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          "Pending",
          "Approved",
          "Rejected",
          "Cancelled",
          "Returned Early"
        ),
        defaultValue: "Pending",
      },
      approverId: {
        type: DataTypes.UUID,
        allowNull: true,
        // references: {
        //   model: "users",
        //   key: "id",
        // },
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      attachmentUrl: {
        type: DataTypes.STRING,
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
      tableName: "leaves",
      timestamps: true,
    }
  );

  Leave.associate = (models) => {
    Leave.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      constraints: false,
    });

    Leave.belongsTo(models.users, {
      foreignKey: "approverId",
      as: "approver",
      constraints: false,
    });
  };

  return Leave;
};
