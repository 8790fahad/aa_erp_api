"use strict";

module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define(
    "UserBranch",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.CHAR(36),
        allowNull: false,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      is_primary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "user_branches",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ unique: true, fields: ["user_id", "branch_id"] }],
    }
  );

  UserBranch.associate = (models) => {
    if (models.users) {
      UserBranch.belongsTo(models.users, {
        foreignKey: "user_id",
        as: "user",
      });
    }
    if (models.Branch) {
      UserBranch.belongsTo(models.Branch, {
        foreignKey: "branch_id",
        as: "branch",
      });
    }
  };

  return UserBranch;
};
