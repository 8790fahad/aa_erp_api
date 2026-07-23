"use strict";
module.exports = (sequelize, DataTypes) => {
  const Membership = sequelize.define(
    "membership",
    {
      business_id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.CHAR(36).BINARY,
        allowNull: false,
        primaryKey: true,
      },
      access_to: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      role: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      functionalities: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      departmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
  },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "membership",
      timestamps: false, // Assuming the table doesn't have createdAt/updatedAt
    }
  );

  Membership.associate = (models) => {
    // Membership belongs to User
    Membership.belongsTo(models.users, {
      foreignKey: "user_id",
      as: "user",
    });

    // Membership belongs to Business
    if (models.business) {
      Membership.belongsTo(models.business, {
        foreignKey: "business_id",
        as: "business",
      });
    }

    // Membership belongs to Department
    if (models.Department) {
      Membership.belongsTo(models.Department, {
        foreignKey: "departmentId",
        as: "department",
      });
    }
  };

  return Membership;
};
