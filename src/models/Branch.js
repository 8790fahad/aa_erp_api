"use strict";
module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    "Branch",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      branch_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      branch_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      crm: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      facilityId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      store_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      admin: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      admin_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "branches",
      timestamps: false,
    }
  );

  Branch.associate = (models) => {
    Branch.hasMany(models.users, {
      foreignKey: "branchId",
      as: "staff",
    });
  };

  return Branch;
};
