"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PurchaseRequisition extends Model {
    static associate(models) {
      // PurchaseRequisition has many RequisitionDetails
      if (models.RequisitionDetail) {
        PurchaseRequisition.hasMany(models.RequisitionDetail, {
          foreignKey: "pr_no",
          sourceKey: "pr_no",
          as: "requisition_details",
        });
      }

      // PurchaseRequisition belongs to Facility
      if (models.Facility) {
        PurchaseRequisition.belongsTo(models.Business, {
          foreignKey: "facilityId",
          as: "business",
        });
      }
    }
  }

  PurchaseRequisition.init(
    {
      pr_no: {
        type: DataTypes.STRING(255),
        primaryKey: true,
        allowNull: false,
        field: "pr_no",
      },
      po_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "po_no",
      },
      memo_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "memo_id",
      },
      requisitor: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "requisitor",
      },
      branch: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "branch",
      },
      branch_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "branch_id",
      },
      user_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "user_id",
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "reason",
      },
      supplier_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "supplier_name",
      },
      supplier_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "supplier_code",
      },
      account_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "account_code",
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        field: "status",
      },
      amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: false,
        defaultValue: 0.0,
        field: "amount",
      },
      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: 0.0,
        field: "total",
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "date",
      },
      facilityId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "facilityId",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "created_at",
      },
    },
    {
      sequelize,
      modelName: "PurchaseRequisition",
      tableName: "purchase_requisition",
      timestamps: false, // only created_at column
      indexes: [
        { fields: ["supplier_code", "account_code"] },
        { fields: ["memo_id"] },
      ],
    }
  );

  return PurchaseRequisition;
};
