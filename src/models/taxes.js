
"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Tax extends Model {
    static associate(models) {
      // Tax belongs to Facility
      if (models.Facility) {
        Tax.belongsTo(models.Facility, {
          foreignKey: "facilityId",
          as: "facility",
        });
      }
    }
  }

  Tax.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      tax_category: {
        type: DataTypes.ENUM("Sales", "Purchase", "Other"),
        allowNull: false,
        defaultValue: "Other",
      },
      description: {
        type: DataTypes.STRING(400),
        allowNull: false,
        validate: { notEmpty: true },
      },
      rate_type: {
        type: DataTypes.STRING(400),
        allowNull: false,
        validate: { notEmpty: true },
      },
      rate: {
        type: DataTypes.STRING(400),
        allowNull: false,
        validate: { notEmpty: true },
      },
      inclusive_type: {
        type: DataTypes.ENUM("inclusive", "exclusive"),
        allowNull: false,
        defaultValue: "exclusive",
        field: "inclusive_type",
        validate: {
          isIn: {
            args: [["inclusive", "exclusive"]],
            msg: "inclusive_type must be either 'inclusive' or 'exclusive'",
          },
        },
      },
      taxes_created_by: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "taxes_created_by",
      },
      account_sub_head: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "account_sub_head",
        validate: { notEmpty: true },
      },
      head: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "head",
      },
      facilityId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "facilityId",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "updated_at",
      },
    },
    {
      sequelize,
      modelName: "Tax",
      tableName: "taxes",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["id"],
        },
        {
          fields: ["head"],
        },
        {
          fields: ["account_sub_head"],
        },
        {
          fields: ["facilityId"],
        },
        {
          fields: ["taxes_created_by"],
        },
      ],
    }
  );

  return Tax;
};
