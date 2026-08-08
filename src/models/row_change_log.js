"use strict";

module.exports = (sequelize, DataTypes) => {
  const RowChangeLog = sequelize.define(
    "row_change_log",
    {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      table_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      action: {
        type: DataTypes.ENUM("INSERT", "UPDATE", "DELETE"),
        allowNull: false,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      row_pk: {
        type: DataTypes.STRING(191),
        allowNull: true,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      before_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      after_data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "row_change_logs",
      timestamps: false,
      underscored: true,
      freezeTableName: true,
    },
  );

  RowChangeLog.associate = (models) => {
    if (models.business || models.Business) {
      const Business = models.business || models.Business;
      RowChangeLog.belongsTo(Business, {
        foreignKey: "facility_id",
        targetKey: "id",
        as: "business",
        constraints: false,
      });
    }
    if (models.users) {
      RowChangeLog.belongsTo(models.users, {
        foreignKey: "user_id",
        targetKey: "id",
        as: "user",
        constraints: false,
      });
    }
  };

  return RowChangeLog;
};
