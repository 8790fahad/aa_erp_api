"use strict";
module.exports = (sequelize, DataTypes) => {
  const LoanRepayment = sequelize.define(
    "loan_repayments",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      loanId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      paymentDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      paymentMethod: {
        type: DataTypes.ENUM("Manual", "Payroll Deduction"),
        allowNull: false,
      },
      reference: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
    },
    {
      tableName: "loan_repayments",
      timestamps: true,
    }
  );

  LoanRepayment.associate = (models) => {
    LoanRepayment.belongsTo(models.loans, {
      foreignKey: "loanId",
      as: "loan",
      targetKey: "id",
      constraints: false,
    });
  };

  return LoanRepayment;
};
