"use strict";
module.exports = (sequelize, DataTypes) => {
  const LeaveBalance = sequelize.define(
    "leave_balances",
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "employees",
          key: "id",
        },
      },
      facilityId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      leaveType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      totalDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      usedDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      remainingDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      accruedDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastAccrualDate: {
        type: DataTypes.DATE,
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
      tableName: "leave_balances",
      timestamps: true,
    }
  );

  LeaveBalance.associate = (models) => {
    LeaveBalance.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
    });

    // Add foreign key relationship to leave_types
    LeaveBalance.belongsTo(models.leave_types, {
      foreignKey: "leaveType",
      targetKey: "code",
      as: "leaveTypeInfo",
    });
  };

  return LeaveBalance;
};
