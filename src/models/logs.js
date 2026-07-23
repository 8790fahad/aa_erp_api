"use strict";
module.exports = (sequelize, DataTypes) => {
  const Log = sequelize.define(
    "logs",
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      type: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(20, 3),
        allowNull: true,
      },
      role: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
      id_link: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      remark: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(250),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('REQUESTED', 'reviewed', 'approved', 'rejected', 'matched', 'unmatched', 'open', 'resolved', 'processed'),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      facilityId: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
    },
    {
      tableName: "logs",
      timestamps: false, // Using date column instead of createdAt/updatedAt
    }
  );

  Log.associate = (models) => {
    // Log belongs to User
    if (models.users) {
      Log.belongsTo(models.users, {
        foreignKey: "user_id",
        targetKey: "id",
        as: "user",
      });
    }
  };

  return Log;
};
