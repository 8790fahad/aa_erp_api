"use strict";
const { Model } = require("sequelize");

/** Sales Management flowchart stages (AA ERP). */
const SALE_WORKFLOW_STAGES = [
  { id: "sales_order", label: "Create Sales Order", phase: "order" },
  { id: "invoice_generated", label: "Generate Invoice", phase: "order" },
  { id: "submitted", label: "Submit for Processing", phase: "order" },
  {
    id: "awaiting_payment",
    label: "Receive Payment (Cash / Transfer)",
    phase: "payment_cash",
  },
  {
    id: "awaiting_cashier_confirm",
    label: "Cashier Confirms Payment",
    phase: "payment_cash",
  },
  {
    id: "payment_confirmed",
    label: "Payment Confirmed",
    phase: "payment_cash",
  },
  {
    id: "awaiting_credit_approval",
    label: "Review & Approve Credit",
    phase: "payment_credit",
  },
  {
    id: "credit_approved",
    label: "Credit Approved",
    phase: "payment_credit",
  },
  {
    id: "invoice_separation",
    label: "Invoice Separation",
    phase: "fulfillment",
  },
  {
    id: "final_invoice",
    label: "Invoice Generation",
    phase: "fulfillment",
  },
  {
    id: "warehouse_picking",
    label: "Warehouse Picks Items",
    phase: "fulfillment",
  },
  {
    id: "dual_signature",
    label: "Dual Signature Verification",
    phase: "fulfillment",
  },
  {
    id: "goods_released",
    label: "Release Goods to Customer",
    phase: "fulfillment",
  },
  { id: "completed", label: "Completed", phase: "done" },
];

const STAGE_IDS = SALE_WORKFLOW_STAGES.map((s) => s.id);

function nextStageFor(current, paymentType) {
  const isPaid =
    paymentType === "cash" ||
    paymentType === "transfer" ||
    paymentType === "split" ||
    paymentType === "bank";

  const map = {
    sales_order: "invoice_generated",
    invoice_generated: "submitted",
    submitted: isPaid ? "awaiting_cashier_confirm" : "awaiting_credit_approval",
    awaiting_payment: "awaiting_cashier_confirm",
    awaiting_cashier_confirm: "payment_confirmed",
    payment_confirmed: "invoice_separation",
    awaiting_credit_approval: "credit_approved",
    credit_approved: "invoice_separation",
    invoice_separation: "final_invoice",
    final_invoice: "warehouse_picking",
    warehouse_picking: "dual_signature",
    dual_signature: "goods_released",
    goods_released: "completed",
    completed: null,
  };
  return map[current] || null;
}

function stagesForPaymentType(paymentType) {
  const isPaid =
    paymentType === "cash" ||
    paymentType === "transfer" ||
    paymentType === "split" ||
    paymentType === "bank";
  return SALE_WORKFLOW_STAGES.filter((s) => {
    if (s.phase === "payment_cash") return isPaid;
    if (s.phase === "payment_credit") return !isPaid;
    return true;
  });
}

module.exports = (sequelize, DataTypes) => {
  class SaleWorkflow extends Model {
    static associate(models) {
      if (models.Business) {
        SaleWorkflow.belongsTo(models.Business, {
          foreignKey: "facility_id",
          targetKey: "id",
          constraints: false,
          as: "business",
        });
      }
    }
  }

  SaleWorkflow.init(
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
        allowNull: false,
      },
      customer_no: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      customer_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      payment_type: {
        type: DataTypes.ENUM(
          "credit",
          "cash",
          "transfer",
          "split",
          "bank",
        ),
        allowNull: false,
        defaultValue: "credit",
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "submitted",
      },
      amount: {
        type: DataTypes.DECIMAL(20, 2),
        allowNull: true,
      },
      branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      hold_overnight: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "If not paid before closing hours",
      },
      history: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "SaleWorkflow",
      tableName: "sale_workflows",
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ["facility_id", "sale_code"] },
        { fields: ["status"] },
        { fields: ["payment_type"] },
      ],
    },
  );

  SaleWorkflow.STAGES = SALE_WORKFLOW_STAGES;
  SaleWorkflow.STAGE_IDS = STAGE_IDS;
  SaleWorkflow.nextStageFor = nextStageFor;
  SaleWorkflow.stagesForPaymentType = stagesForPaymentType;

  return SaleWorkflow;
};

module.exports.SALE_WORKFLOW_STAGES = SALE_WORKFLOW_STAGES;
module.exports.nextStageFor = nextStageFor;
module.exports.stagesForPaymentType = stagesForPaymentType;
