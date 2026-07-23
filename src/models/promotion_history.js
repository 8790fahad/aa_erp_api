"use strict";
module.exports = (sequelize, DataTypes) => {
  const PromotionHistory = sequelize.define(
    "promotion_history",
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
        // references: {
        //   model: "employees",
        //   key: "id",
        // },
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      previousDesignation: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      newDesignation: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      previousDepartmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      newDepartmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      previousSalaryStructureId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
      newSalaryStructureId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
      previousSalary: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
      },
      newSalary: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
      },
      effectiveDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approvedBy: {
        type: DataTypes.CHAR(36).BINARY,
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
      status: {
        type: DataTypes.ENUM("Pending", "Approved", "Rejected", "Cancelled"),
        defaultValue: "Pending",
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
      tableName: "promotion_history",
      timestamps: true,
    }
  );

  PromotionHistory.associate = (models) => {
    // PromotionHistory.belongsTo(models.employees, {
    //   foreignKey: "employeeId",
    //   as: "employee",
    //   targetKey: "id",
    //   constraints: false,
    // });

    // PromotionHistory.belongsTo(models.users, {
    //   foreignKey: "approvedBy",
    //   as: "approver",
    //   targetKey: "id",
    //   constraints: false,
    // });

    // PromotionHistory.belongsTo(models.Department, {
    //   foreignKey: "previousDepartmentId",
    //   as: "previousDepartment",
    //   targetKey: "id",
    //   constraints: false,
    // });

    // PromotionHistory.belongsTo(models.Department, {
    //   foreignKey: "newDepartmentId",
    //   as: "newDepartment",
    //   targetKey: "id",
    //   constraints: false,
    // });

    // PromotionHistory.belongsTo(models.salary_structures, {
    //   foreignKey: "previousSalaryStructureId",
    //   as: "previousSalaryStructure",
    //   targetKey: "id",
    //   constraints: false,
    // });

    // PromotionHistory.belongsTo(models.salary_structures, {
    //   foreignKey: "newSalaryStructureId",
    //   as: "newSalaryStructure",
    //   targetKey: "id",
    //   constraints: false,
    // });
  };

  return PromotionHistory;
};