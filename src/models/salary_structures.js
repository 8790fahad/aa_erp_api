"use strict";
module.exports = (sequelize, DataTypes) => {
  const SalaryStructure = sequelize.define(
    "salary_structures",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      structureName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      structureCode: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      basicSalary: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      paymentType: {
        type: DataTypes.ENUM("Monthly", "Hourly", "Daily"),
        defaultValue: "Monthly",
      },
      allowances: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON object containing allowance types and amounts",
      },
      deductions: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "JSON object containing deduction types and amounts",
      },
      salaryComponents: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        comment:
          "JSON array containing unified salary components (allowances and deductions) with type, name, amount, and calculationType",
      },
      roleBasedComponents: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        comment:
          "JSON array containing role-based salary components with type, name, amount, calculationType, roleId, and roleName",
      },
      overtimeRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 1.5,
        comment: "Multiplier for overtime hours (e.g., 1.5 for time and half)",
      },
      payeRate: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
        defaultValue: 0,
        comment:
          "PAYE: fixed amount or percentage-scale value (payroll calculation)",
      },
      pensionRate: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
        defaultValue: 0,
        comment:
          "Pension: fixed amount or percentage-scale value (payroll calculation)",
      },
      status: {
        type: DataTypes.ENUM("Active", "Inactive"),
        defaultValue: "Active",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      accountCode: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Chart of account code for accounting integration",
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
      tableName: "salary_structures",
      timestamps: true,
    }
  );

  SalaryStructure.associate = (models) => {
    SalaryStructure.hasMany(models.employees, {
      foreignKey: "salaryStructureId",
      as: "employees",
      constraints: false,
    });
  };

  return SalaryStructure;
};
