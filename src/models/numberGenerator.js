"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class NumberGenerator extends Model {
    static associate(models) {
      // Define associations here if needed
      // For example, if it's related to a Business/Facility
      if (models.Business) {
        NumberGenerator.belongsTo(models.Business, {
          foreignKey: "facilityId",
          targetKey: "id",
          as: "business",
        });
      }
    }
  }

  NumberGenerator.init(
    {
      description: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "Description of the number generator type"
      },
      prefix: {
        type: DataTypes.STRING(100),
        allowNull: false,
        primaryKey: true,
        comment: "Prefix for the generated numbers"
      },
      code_no: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Current code number for generation"
      },
      facilityId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        primaryKey: true,
        comment: "Facility ID for multi-tenancy"
      }
    },
    {
      sequelize,
      modelName: "NumberGenerator",
      tableName: "number_generator",
      timestamps: false, // Since no created_at/updated_at columns mentioned
      indexes: [
        {
          unique: true,
          fields: ["prefix", "facilityId"], // Composite primary key
        },
      ],
    }
  );

  return NumberGenerator;
};