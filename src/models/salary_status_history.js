"use strict";
module.exports = (sequelize, DataTypes) => {
  const SalaryStatusHistory = sequelize.define(
    "salary_status_history",
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
        references: null, // suppress FK constraint in CREATE TABLE (avoids errno 150)
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("Active", "Stopped"),
        allowNull: false,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      performedBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
    },
    {
      tableName: "salary_status_history",
      timestamps: true,
    }
  );

  SalaryStatusHistory.associate = (models) => {
    SalaryStatusHistory.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
      targetKey: "id",
      constraints: false,
    });
    SalaryStatusHistory.belongsTo(models.users, {
      foreignKey: "performedBy",
      as: "actor",
      targetKey: "id",
      constraints: false,
    });
  };

  return SalaryStatusHistory;
};
