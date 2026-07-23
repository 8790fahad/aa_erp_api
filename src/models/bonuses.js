"use strict";
module.exports = (sequelize, DataTypes) => {
  const Bonus = sequelize.define(
    "bonuses",
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
      employeeName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      bonusType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
      },
      calculationType: {
        type: DataTypes.ENUM("fixed", "percentage"),
        allowNull: false,
        defaultValue: "fixed",
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      bonusDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "paid", "rejected"),
        allowNull: false,
        defaultValue: "pending",
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
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      accountCode: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      isTaxable: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether bonus is included in taxable gross pay for PAYE",
      },
      createdBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        // references: {
        //   model: "users",
        //   key: "id",
        // },
      },
      updatedBy: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: true,
        // references: {
        //   model: "users",
        //   key: "id",
        // },
      },
    },
    {
      tableName: "bonuses",
      timestamps: true,
      charset: "latin1",
      collate: "latin1_swedish_ci",
      indexes: [
        {
          fields: ["facilityId"],
        },
        {
          fields: ["employeeId"],
        },
        {
          fields: ["status"],
        },
        {
          fields: ["bonusDate"],
        },
      ],
    }
  );

  Bonus.associate = function (models) {
    // Associate with Employee
    Bonus.belongsTo(models.employees, {
      foreignKey: "employeeId",
      as: "employee",
    });

    // Associate with User (creator)
    Bonus.belongsTo(models.users, {
      foreignKey: "createdBy",
      as: "creator",
    });

    // Associate with User (approver)
    Bonus.belongsTo(models.users, {
      foreignKey: "approvedBy",
      as: "approver",
    });

    // Associate with User (updater)
    Bonus.belongsTo(models.users, {
      foreignKey: "updatedBy",
      as: "updater",
    });
  };

  return Bonus;
};
