"use strict";
module.exports = (sequelize, DataTypes) => {
  const Attendance = sequelize.define(
    "attendance",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY, // match employees.id
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      employeeId: {
        type: DataTypes.CHAR(36).BINARY, // must match employees.id
        allowNull: false,
        // references: {
        //   model: "employees",
        //   key: "id",
        // },
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY, // keep consistent
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      clockInTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      clockOutTime: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      totalHours: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0,
      },
      overtimeHours: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.ENUM(
          "Present",
          "Absent",
          "Late",
          "Half Day",
          "On Leave"
        ),
        allowNull: false,
        defaultValue: "Absent",
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isManualEntry: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      approvedBy: {
        type: DataTypes.CHAR(36).BINARY, // must match users.id
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
      createdBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      updatedBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
    },
    {
      tableName: "attendance",
      timestamps: true,
    }
  );

  Attendance.associate = (models) => {
    // Associate with employees table
    Attendance.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });

    // Associate with users table for approver
    Attendance.belongsTo(models.users, {
      foreignKey: "approvedBy",
      as: "approver",
      constraints: false, // Disable constraints to avoid FK issues during sync
    });
  };

  return Attendance;
};
