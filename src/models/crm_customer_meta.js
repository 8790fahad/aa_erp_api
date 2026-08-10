"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CrmCustomerMeta extends Model {
    static associate(models) {
      if (models.Customer) {
        CrmCustomerMeta.belongsTo(models.Customer, {
          foreignKey: "customer_no",
          targetKey: "customerNo",
          constraints: false,
          as: "customer",
        });
      }
    }
  }

  CrmCustomerMeta.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      facility_id: { type: DataTypes.STRING(50), allowNull: false },
      customer_no: { type: DataTypes.STRING(50), allowNull: false },
      crm_status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "New",
      },
      segment_key: { type: DataTypes.STRING(100), allowNull: true },
      assigned_user_id: { type: DataTypes.STRING(50), allowNull: true },
      last_interaction_at: { type: DataTypes.DATE, allowNull: true },
      next_followup_at: { type: DataTypes.DATE, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "CrmCustomerMeta",
      tableName: "crm_customer_meta",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return CrmCustomerMeta;
};
