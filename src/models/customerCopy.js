"use strict";
module.exports = (sequelize, DataTypes) => {
  const CustomerCopy = sequelize.define(
    "CustomerCopy",
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
      customerNo: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      reference_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      data: {
        type: DataTypes.JSON,
        allowNull: false,
      },
    },
    {
      tableName: "customer_copy",
      timestamps: true, // Since we have created_at field manually
    }
  );

  return CustomerCopy;
};
