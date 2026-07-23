"use strict";
module.exports = (sequelize, DataTypes) => {
  const Allowance = sequelize.define(
    "allowances",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "Name of the allowance or deduction",
      },
      type: {
        type: DataTypes.ENUM("allowance", "deduction"),
        allowNull: false,
        comment: "Type: allowance or deduction",
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: "Amount or percentage value",
      },
      calculationType: {
        type: DataTypes.ENUM("fixed", "percentage"),
        allowNull: false,
        defaultValue: "fixed",
        comment: "How the amount is calculated: fixed amount or percentage of salary",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Description of the allowance or deduction",
      },
      isRoleBased: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this allowance/deduction is role-specific",
      },
      roleId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Role ID if this is role-based",
      },
      roleName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Role name for display purposes",
      },
      salaryStructureId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
        comment: "Salary structure ID if this is structure-based",
      },
      salaryStructureName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Salary structure name for display purposes",
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        comment: "Facility/business ID",
      },
      status: {
        type: DataTypes.ENUM("Active", "Inactive"),
        defaultValue: "Active",
        comment: "Status of the allowance/deduction",
      },
      accountCode: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Chart of account code for accounting integration",
      },
      isTaxable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether allowance amount is included in taxable gross pay",
      },
      createdBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        comment: "User ID who created this record",
      },
      updatedBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
        comment: "User ID who last updated this record",
      },
    },
    {
      tableName: "allowances",
      timestamps: true,
    }
  );

  Allowance.associate = (models) => {
    Allowance.belongsTo(models.salary_structures, {
      foreignKey: "salaryStructureId",
      as: "salaryStructure",
      constraints: false,
    });
  };

  return Allowance;
};
