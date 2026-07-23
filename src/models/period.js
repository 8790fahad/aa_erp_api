"use strict";
module.exports = (sequelize, DataTypes) => {
  const Period = sequelize.define(
    "Period",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      facilityId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        // open, soft_closed, closed
        type: DataTypes.ENUM("open", "soft_closed", "closed"),
        allowNull: false,
        defaultValue: "open",
      },
      lockedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "gl_periods",
      timestamps: true,
    }
  );

  return Period;
};








