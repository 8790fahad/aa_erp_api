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
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      discount_type: {
        type: DataTypes.ENUM("Percentage", "Fixed"),
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0.01,
        },
      },
      status: {
        type: DataTypes.ENUM("active", "disabled"),
        allowNull: false,
        defaultValue: "active",
      },
      discount_account_head: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: "Chart of account code (account_category.code)",
      },
      facilityId: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      min_order_amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0,
        comment: "Minimum invoice subtotal required to apply this discount",
      },
      customer_type: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
        comment:
          "Optional customer type this discount applies to (NULL = all types)",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "discount_table",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["facilityId", "discount_name"],
          name: "uq_discount_name_per_facility",
        },
        {
          fields: ["facilityId", "status"],
          name: "idx_discount_facility_status",
        },
        {
          fields: ["discount_account_head", "facilityId"],
          name: "idx_discount_account_head_facility",
        },
      ],
    },
  );

  Discount.associate = (models) => {
    if (models.business) {
      Discount.belongsTo(models.business, {
        foreignKey: "facilityId",
        targetKey: "id",
        as: "business",
      });
    }
  };

  return Discount;
};
