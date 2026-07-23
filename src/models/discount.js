"use strict";
module.exports = (sequelize, DataTypes) => {
  const Discount = sequelize.define(
    "Discount",
    {
      discount_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      discount_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      discount_type: {
        type: DataTypes.ENUM("Percentage", "Fixed"),
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("active", "disabled"),
        defaultValue: "active",
      },
      discount_account_head: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      facilityId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "discount_table",
      timestamps: false,
    }
  );

  return Discount;
};
