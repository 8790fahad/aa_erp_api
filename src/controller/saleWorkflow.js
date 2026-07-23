const db = require("../models");
const {
  SALE_WORKFLOW_STAGES,
  nextStageFor,
  stagesForPaymentType,
} = require("../models/sale_workflows");

function normalizePaymentType(modeOfPayment, isCashSale) {
  if (!isCashSale) return "credit";
  const m = String(modeOfPayment || "").toLowerCase();
  if (m === "split") return "split";
  if (m === "bank" || m === "transfer") return "transfer";
  if (m === "cash") return "cash";
  return "cash";
}

function pushHistory(history, status, userId, note) {
  const list = Array.isArray(history) ? [...history] : [];
  list.push({
    status,
    at: new Date().toISOString(),
    by: userId || null,
    note: note || null,
  });
  return list;
}

/**
 * Create workflow after invoice/sale is posted.
 * Paid sales → awaiting cashier confirm; credit → awaiting credit approval.
 */
async function createSaleWorkflowRecord(
  {
    facilityId,
    saleCode,
    customerNo,
    customerName,
    paymentType,
    amount,
    branchId,
    createdBy,
    holdOvernight = false,
  },
  transaction,
) {
  if (!db.SaleWorkflow || !facilityId || !saleCode) return null;

  const isPaid = paymentType !== "credit";
  const initialStatus = isPaid
    ? "awaiting_cashier_confirm"
    : "awaiting_credit_approval";

  let history = [];
  history = pushHistory(history, "sales_order", createdBy, "Order created");
  history = pushHistory(history, "invoice_generated", createdBy, "Invoice generated");
  history = pushHistory(history, "submitted", createdBy, "Submitted for processing");
  history = pushHistory(
    history,
    initialStatus,
    createdBy,
    isPaid
      ? "Awaiting cashier payment confirmation"
      : "Awaiting credit review & approval",
  );

  const [row] = await db.SaleWorkflow.findOrCreate({
    where: { facility_id: facilityId, sale_code: saleCode },
    defaults: {
      facility_id: facilityId,
      sale_code: saleCode,
      customer_no: customerNo || null,
      customer_name: customerName || null,
      payment_type: paymentType,
      status: initialStatus,
      amount: amount != null ? Number(amount) : null,
      branch_id: branchId || null,
      hold_overnight: Boolean(holdOvernight),
      history,
      created_by: createdBy || null,
      updated_by: createdBy || null,
    },
    transaction,
  });

  return row;
}

exports.SALE_WORKFLOW_STAGES = SALE_WORKFLOW_STAGES;
exports.createSaleWorkflowRecord = createSaleWorkflowRecord;
exports.normalizePaymentType = normalizePaymentType;

exports.getWorkflowStages = async (_req, res) => {
  return res.json({
    success: true,
    results: SALE_WORKFLOW_STAGES,
  });
};

exports.listSaleWorkflows = async (req, res) => {
  try {
    const { facilityId, status, paymentType } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!db.SaleWorkflow) {
      return res.status(500).json({
        success: false,
        message: "SaleWorkflow model not loaded",
      });
    }

    const where = { facility_id: facilityId };
    if (status) where.status = status;
    if (paymentType) where.payment_type = paymentType;

    const rows = await db.SaleWorkflow.findAll({
      where,
      order: [["updated_at", "DESC"]],
      limit: 200,
    });

    const results = rows.map((r) => {
      const plain = r.toJSON();
      const next = nextStageFor(plain.status, plain.payment_type);
      const path = stagesForPaymentType(plain.payment_type);
      return {
        ...plain,
        status_label:
          SALE_WORKFLOW_STAGES.find((s) => s.id === plain.status)?.label ||
          plain.status,
        next_status: next,
        next_status_label:
          SALE_WORKFLOW_STAGES.find((s) => s.id === next)?.label || null,
        stage_path: path,
      };
    });

    return res.json({ success: true, results, count: results.length });
  } catch (err) {
    console.error("listSaleWorkflows:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to list workflows",
    });
  }
};

exports.getSaleWorkflow = async (req, res) => {
  try {
    const { facilityId, saleCode } = req.query;
    if (!facilityId || !saleCode) {
      return res.status(400).json({
        success: false,
        message: "facilityId and saleCode are required",
      });
    }
    const row = await db.SaleWorkflow.findOne({
      where: { facility_id: facilityId, sale_code: saleCode },
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Workflow not found",
      });
    }
    const plain = row.toJSON();
    const next = nextStageFor(plain.status, plain.payment_type);
    return res.json({
      success: true,
      results: {
        ...plain,
        status_label:
          SALE_WORKFLOW_STAGES.find((s) => s.id === plain.status)?.label ||
          plain.status,
        next_status: next,
        next_status_label:
          SALE_WORKFLOW_STAGES.find((s) => s.id === next)?.label || null,
        stage_path: stagesForPaymentType(plain.payment_type),
      },
    });
  } catch (err) {
    console.error("getSaleWorkflow:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.advanceSaleWorkflow = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      saleCode,
      action, // 'advance' | 'hold_overnight' | 'set_status'
      status: forcedStatus,
      note,
      updated_by,
    } = req.body;

    if (!facilityId || !saleCode) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and saleCode are required",
      });
    }

    const row = await db.SaleWorkflow.findOne({
      where: { facility_id: facilityId, sale_code: saleCode },
      transaction,
    });
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Workflow not found",
      });
    }

    if (action === "hold_overnight") {
      row.hold_overnight = true;
      row.history = pushHistory(
        row.history,
        row.status,
        updated_by,
        note || "Held — not paid before closing hours",
      );
      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });
      await transaction.commit();
      return res.json({
        success: true,
        message: "Marked as held overnight",
        results: row,
      });
    }

    let next =
      action === "set_status" && forcedStatus
        ? forcedStatus
        : nextStageFor(row.status, row.payment_type);

    if (!next) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Workflow is already completed",
      });
    }

    const valid = SALE_WORKFLOW_STAGES.some((s) => s.id === next);
    if (!valid) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Invalid status: ${next}`,
      });
    }

    row.status = next;
    row.history = pushHistory(row.history, next, updated_by, note);
    row.updated_by = updated_by || row.updated_by;
    if (next === "payment_confirmed" || next === "credit_approved") {
      row.hold_overnight = false;
    }
    await row.save({ transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message: `Advanced to ${
        SALE_WORKFLOW_STAGES.find((s) => s.id === next)?.label || next
      }`,
      results: {
        ...row.toJSON(),
        next_status: nextStageFor(row.status, row.payment_type),
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("advanceSaleWorkflow:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to advance workflow",
    });
  }
};
