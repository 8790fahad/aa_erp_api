"use strict";

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    "notifications",
    {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      body: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      link: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      entity_type: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      entity_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      actor_user_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "notifications",
      timestamps: false,
      underscored: true,
      freezeTableName: true,
    },
  );

  Notification.associate = (models) => {
    if (models.users) {
      Notification.belongsTo(models.users, {
        foreignKey: "user_id",
        targetKey: "id",
        as: "recipient",
        constraints: false,
      });
    }
  };

  return Notification;
};
