"use strict";
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    "loans",
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
      loanSetupId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      purpose: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      repaymentMethod: {
        type: DataTypes.ENUM("Self", "Salary Deduction"),
        defaultValue: "Salary Deduction",
      },
      status: {
        type: DataTypes.ENUM("Pending", "Approved", "Repaying", "Paid Off", "Rejected"),
        defaultValue: "Pending",
      },
      monthlyDeductionAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      durationMonths: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      amountPaid: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
      },
      startDate: {
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
      receivableHead: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      paymentMode: {
        type: DataTypes.ENUM("bank", "cheque", "cash"),
        allowNull: true,
        defaultValue: "bank",
      },
      bankHead: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      cashHead: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      chequeNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      referenceNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "loans",
      timestamps: true,
    }
  );

  Loan.associate = (models) => {
    Loan.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      targetKey: "id",
      constraints: false,
    });
    Loan.belongsTo(models.loan_setups, {
      foreignKey: "loanSetupId",
      as: "setup",
      targetKey: "id",
      constraints: false,
    });
    Loan.hasMany(models.loan_repayments, {
      foreignKey: "loanId",
      as: "repayments",
      sourceKey: "id",
      constraints: false,
    });
  };

  return Loan;
};
