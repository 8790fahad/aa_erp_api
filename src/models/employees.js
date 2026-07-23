"use strict";
module.exports = (sequelize, DataTypes) => {
  const Employee = sequelize.define(
    "employees",
    {
      id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      employeeId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      userId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      facilityId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
      },
      firstName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      gender: {
        type: DataTypes.ENUM("Male", "Female", "Other"),
        allowNull: false,
      },
      dateOfBirth: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      contactInfo: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      nationalId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      bankAccount: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      bankName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      bankCode: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      accountName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      accountType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      photoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      designation: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      hireDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      contractType: {
        type: DataTypes.ENUM(
          "Permanent",
          "Full-time",
          "Contract",
          "Intern",
          "Part-time"
        ),
        allowNull: false,
      },
      salaryStructureId: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("Active", "Inactive", "Terminated", "On Leave"),
        defaultValue: "Active",
      },
      salaryStatus: {
        type: DataTypes.ENUM("Active", "Stopped"),
        defaultValue: "Active",
      },
      salaryStatusReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      salaryStatusDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      emergencyContact: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      emergencyPhone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      nextOfKin: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      nextOfKinPhone: {
        type: DataTypes.STRING,
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
      tableName: "employees",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["facilityId", "employeeId"],
        },
      ],
    }
  );

  Employee.associate = (models) => {
    Employee.belongsTo(models.users, {
      foreignKey: "userId",
      as: "user",
      targetKey: "id",
      constraints: false,
    });

    Employee.belongsTo(models.Department, {
      foreignKey: "departmentId",
      as: "department",
      targetKey: "id",
      constraints: false,
    });

    Employee.belongsTo(models.salary_structures, {
      foreignKey: "salaryStructureId",
      as: "salaryStructure",
      targetKey: "id",
      constraints: false,
    });

    Employee.hasMany(models.leaves, {
      foreignKey: "employeeId",
      as: "leaves",
    });

    Employee.hasMany(models.payroll, {
      foreignKey: "employeeId",
      as: "payrolls",
    });

    Employee.hasMany(models.attendance, {
      foreignKey: "employeeId",
      as: "attendance",
    });

    Employee.hasMany(models.performance, {
      foreignKey: "employeeId",
      as: "performance",
    });

    Employee.hasMany(models.loans, {
      foreignKey: "employeeId",
      as: "loans",
      constraints: false,
    });

    Employee.hasMany(models.leave_balances, {
      foreignKey: "employeeId",
      as: "leaveBalances",
    });

    Employee.hasMany(models.salary_status_history, {
      foreignKey: "employeeId",
      as: "salaryStatusHistory",
    });

    Employee.hasOne(models.employee_paye_profiles, {
      foreignKey: "employeeId",
      as: "payeProfile",
      constraints: false,
    });
  };

  return Employee;
};
