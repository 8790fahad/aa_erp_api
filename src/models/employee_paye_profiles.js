"use strict";

module.exports = (sequelize, DataTypes) => {
  const EmployeePayeProfile = sequelize.define(
    "employee_paye_profiles",
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
        unique: true,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      payEntryFrequency: {
        type: DataTypes.ENUM("monthly", "annual"),
        allowNull: false,
        defaultValue: "monthly",
      },
      basicSalary: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      housingAllowance: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      transportAllowance: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      otherAllowances: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      nonTaxableAllowances: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: "Allowances excluded from taxable gross / PAYE chargeable income",
      },
      bonus: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      isBonusTaxable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether profile bonus amount is taxable for PAYE",
      },
      annualRent: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
      },
      appliesRent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesNHF: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesNHIS: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      appliesPension: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "employee_paye_profiles",
      timestamps: true,
    }
  );

  EmployeePayeProfile.associate = (models) => {
    EmployeePayeProfile.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      constraints: false,
    });
  };

  return EmployeePayeProfile;
};
