"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class RequisitionDetail extends Model {
    static associate(models) {
      // RequisitionDetail belongs to PurchaseRequisition
      if (models.PurchaseRequisition) {
        RequisitionDetail.belongsTo(models.PurchaseRequisition, {
          foreignKey: "pr_no",
          targetKey: "pr_no",
          as: "purchase_requisition",
        });
      }

      // RequisitionDetail belongs to Facility
      if (models.Business) {
        RequisitionDetail.belongsTo(models.Business, {
          foreignKey: "id",
          as: "business",
        });
      }
      if (models.Product) {
        RequisitionDetail.belongsTo(models.Product, {
          foreignKey: "item_code",
          as: "product",
        });
      }
    }
  }

  RequisitionDetail.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      pr_no: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "pr_no",
      },
      item_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "item_code",
        references: {
          model: "products",
          key: "sku",
        },
      },
      item_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "item_name",
      },
      chart_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "chart_code",
      },
      est_cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: "est_cost",
      },
      unit_category: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "unit_category",
      },
      unit_measure: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "unit_measure",
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "quantity",
      },
      approved_qty: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: true,
        field: "approved_qty",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
      facilityId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "facilityId",
      },
    },
    {
      sequelize,
      modelName: "RequisitionDetail",
      tableName: "requisition_details",
      timestamps: false, // table has only created_at, no updated_at
      indexes: [
        { fields: ["pr_no"] },
        { fields: ["item_code", "chart_code"] },
        { fields: ["facilityId"] },
      ],
    }
  );

  return RequisitionDetail;
};
