"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CustomerFeedback extends Model {}

  CustomerFeedback.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      facility_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      sale_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      customer_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      customer_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "CustomerFeedback",
      tableName: "customer_feedbacks",
      timestamps: true,
      underscored: true,
    },
  );

  return CustomerFeedback;
};
