"use strict";
module.exports = (sequelize, DataTypes) => {
  const Department = sequelize.define(
    "Department",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      departmentName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      departmentCode: DataTypes.STRING,
      facilityId: DataTypes.STRING,
      description: DataTypes.TEXT,
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },
      type: {
        type: DataTypes.ENUM("others", "main"),
        allowNull: false,
        defaultValue: "others",
      },
      headOfDepartment: {
        type: DataTypes.CHAR(36),
        allowNull: true,
      },
    },
    {
      tableName: "Departments",
      timestamps: true,
    }
  );

  Department.associate = (models) => {
    // Note: Circular dependency removed - associations are handled in users model
    // Department.hasMany(models.users, {
    //   foreignKey: "departmentId",
    //   as: "members",
    // });
    // Department.belongsTo(models.users, {
    //   foreignKey: "headOfDepartment",
    //   as: "head",
    // });
  };

  return Department;
};
