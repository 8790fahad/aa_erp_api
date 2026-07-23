"use strict";
module.exports = (sequelize, DataTypes) => {
  const Payroll = sequelize.define(
    "payroll",
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
      month: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      basicSalary: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      allowances: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      overtime: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      allowance_details: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
      },
      deductions: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      deduction_details: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
      },
      loanRepayment: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      bonuses: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      bonus_details: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
      },
      paye: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      computedPaye: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        comment: "Formula-driven PAYE before manual override",
      },
      payeOverride: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        comment: "Manual monthly PAYE when auto-calculation is off",
      },
      pension: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      netPay: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      grossPay: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      payslipUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("Draft", "Processed", "Paid", "Cancelled"),
        defaultValue: "Draft",
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      workingDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 22,
      },
      presentDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 22,
      },
      overtimeHours: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },
      paymentType: {
        type: DataTypes.ENUM("Monthly", "Daily", "Hourly"),
        allowNull: true,
        defaultValue: "Monthly",
        comment: "Payment calculation type inherited from salary structure",
      },
      paymentNote: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Human-readable note about how basicSalary was computed",
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
      tableName: "payroll",
      timestamps: true,
    }
  );

  Payroll.associate = (models) => {
    Payroll.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      constraints: false,
    });
  };

  return Payroll;
};

