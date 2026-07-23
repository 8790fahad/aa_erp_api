const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const ProductMultiplier = sequelize.define(
    "product_multipliers",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
        field: "id",
      },
      multiplier_value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: "multiplier_value",
        validate: {
          min: 0,
        },
      },
      multiplier_type: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "multiplier_type",
        validate: {
          notEmpty: true,
        },
      },
      sku: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "sku",
        references: {
          model: "products",
          key: "sku",
        },
      },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
        field: "status",
      },
      facilityId: {
        type: DataTypes.STRING(36),
        allowNull: false,
        field: "facilityId",
        charset: "utf8mb4",
        collate: "utf8mb4_general_ci",
        references: {
          model: "business",
          key: "id",
        },
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "createdAt",
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "updatedAt",
      },
    },
    {
      tableName: "product_multipliers",
      timestamps: true,
      indexes: [
        {
          fields: ["facilityId"],
        },

        {
          fields: ["sku"],
        },
        {
          fields: ["status"],
        },
      ],
    }
  );

  return ProductMultiplier;
};
