"use strict";
const { Model } = require("sequelize");

/** Sales Management flowchart stages (Alh. Ashiru Yanmusa). */
const SALE_WORKFLOW_STAGES = [
  { id: "sales_order", label: "Create Sales Order", phase: "order", color: "slate" },
  { id: "invoice_generated", label: "Generate Invoice", phase: "order", color: "slate" },
  { id: "submitted", label: "Submit for Processing", phase: "order", color: "slate" },
  {
    id: "awaiting_payment",
    label: "Receive Payment (Cash / Transfer)",
    phase: "payment_cash",
    color: "amber",
  },
  {
    id: "awaiting_discount_approval",
    label: "Review & Approve Discount",
    phase: "payment_cash",
    color: "orange",
  },
  {
    id: "awaiting_payment_mode_approval",
    label: "Review & Approve Payment Mode Switch",
    phase: "payment_cash",
    color: "indigo",
  },
  {
    id: "awaiting_cashier_confirm",
    label: "Cashier Confirms Payment",
    phase: "payment_cash",
    color: "amber",
  },
  {
    id: "payment_confirmed",
    label: "Payment Confirmed",
    phase: "payment_cash",
    color: "green",
  },
  {
    id: "awaiting_credit_approval",
    label: "Review & Approve Credit",
    phase: "payment_credit",
    color: "rose",
  },
  {
    id: "credit_approved",
    label: "Credit Approved",
    phase: "payment_credit",
    color: "green",
  },
  {
    id: "invoice_separation",
    label: "Invoice Separation",
    phase: "fulfillment",
    color: "violet",
  },
  {
    id: "final_invoice",
    label: "Invoice Generation",
    phase: "fulfillment",
    color: "blue",
  },
  {
    id: "warehouse_picking",
    label: "Warehouse Picks Items",
    phase: "fulfillment",
    color: "orange",
  },
  {
    id: "dual_signature",
    label: "Dual Signature Verification",
    phase: "fulfillment",
    color: "teal",
  },
  {
    id: "goods_released",
    label: "Release Goods to Customer",
    phase: "fulfillment",
    color: "cyan",
  },
  { id: "completed", label: "Completed", phase: "done", color: "emerald" },
];

const STAGE_IDS = SALE_WORKFLOW_STAGES.map((s) => s.id);

function nextStageFor(current, paymentType) {
  const isPaid =
    paymentType === "cash" ||
    paymentType === "transfer" ||
    paymentType === "split" ||
    paymentType === "credit_split" ||
    paymentType === "bank";
  const isWarehouse = paymentType === "warehouse";
  const isDeposit = paymentType === "deposit";

  const map = {
    sales_order: "invoice_generated",
    invoice_generated: "submitted",
    submitted: isPaid
      ? "awaiting_cashier_confirm"
      : isWarehouse
        ? "invoice_separation"
        : isDeposit
          ? "awaiting_payment"
          : "awaiting_credit_approval",
    awaiting_discount_approval: isPaid
      ? "awaiting_cashier_confirm"
      : isDeposit
        ? "awaiting_payment"
        : "awaiting_credit_approval",
    awaiting_payment: isDeposit
      ? "invoice_separation"
      : "awaiting_cashier_confirm",
    awaiting_cashier_confirm: "payment_confirmed",
    payment_confirmed: "invoice_separation",
    awaiting_credit_approval: "credit_approved",
    credit_approved: "invoice_separation",
    // Separation produces one invoice copy per branch, then warehouse collect
    invoice_separation: "warehouse_picking",
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
    paymentType === "credit_split" ||
    paymentType === "bank";
  const isWarehouse = paymentType === "warehouse";
  const isDeposit = paymentType === "deposit";

  // Cash/transfer: Invoice → Cashier → Separation → Warehouse → Done
  // Warehouse: Invoice → Separation → Warehouse → Done (no cashier)
  // Credit: Invoice → Credit approval → Separation → Warehouse → Done
  // Deposit: Invoice → Apply Deposit → (Credit if remainder) → Separation → Warehouse → Done
  const core = [
    { id: "invoice_generated", label: "Invoice generated", phase: "order", color: "slate" },
  ];
  if (isPaid) {
    core.push({
      id: "awaiting_cashier_confirm",
      label: paymentType === "credit_split" ? "Cash + Transfer (+ Credit)" : "Cashier",
      phase: "payment_cash",
      color: "amber",
    });
  } else if (isDeposit) {
    core.push({
      id: "awaiting_payment",
      label: "Apply Deposit",
      phase: "payment_cash",
      color: "teal",
    });
  } else if (!isWarehouse) {
    core.push({
      id: "awaiting_credit_approval",
      label: "Credit approval",
      phase: "payment_credit",
      color: "rose",
    });
  }
  core.push(
    {
      id: "invoice_separation",
      label: "Separation",
      phase: "fulfillment",
      color: "green",
    },
    {
      id: "warehouse_picking",
      label: "Warehouse",
      phase: "fulfillment",
      color: "orange",
    },
    { id: "completed", label: "Done", phase: "done", color: "emerald" },
  );
  return core;
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
          "warehouse",
          "credit_split",
          "deposit",
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
      assigned_cashier_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "User id of cashier assigned at invoice create",
      },
      assigned_cashier_name: {
        type: DataTypes.STRING(150),
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
        { fields: ["assigned_cashier_id"] },
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
