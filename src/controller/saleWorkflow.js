const db = require("../models");
const { Op } = require("sequelize");
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

function normalizeHistory(history) {
  if (Array.isArray(history)) return history;
  if (typeof history === "string" && history.trim()) {
    try {
      const parsed = JSON.parse(history);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (history && typeof history === "object") {
    // Occasionally drivers return a single object instead of an array.
    return [history];
  }
  return [];
}

function pushHistory(history, status, userId, note, extra = null) {
  const list = [...normalizeHistory(history)];
  const entry = {
    status,
    at: new Date().toISOString(),
    by: userId || null,
    note: note || null,
  };
  if (extra && typeof extra === "object") {
    Object.assign(entry, extra);
  }
  list.push(entry);
  return list;
}

/** Track partial Cash + Transfer collections on split invoices. */
function getSplitCollectionProgress(history) {
  const list = normalizeHistory(history);
  let cash = 0;
  let transfer = 0;
  let cash_by = null;
  let transfer_by = null;
  let cash_at = null;
  let transfer_at = null;
  for (const h of list) {
    const side = String(h?.collection?.side || "").toLowerCase();
    const amt = Number(h?.collection?.amount) || 0;
    if (!amt) continue;
    if (side === "cash") {
      cash += amt;
      cash_by = h.by || cash_by;
      cash_at = h.at || cash_at;
    } else if (side === "transfer" || side === "bank") {
      transfer += amt;
      transfer_by = h.by || transfer_by;
      transfer_at = h.at || transfer_at;
    }
  }
  return {
    cash: Number(cash.toFixed(2)),
    transfer: Number(transfer.toFixed(2)),
    cash_done: cash > 0.05,
    transfer_done: transfer > 0.05,
    cash_by,
    transfer_by,
    cash_at,
    transfer_at,
    collected_total: Number((cash + transfer).toFixed(2)),
  };
}

function stageMeta(statusId) {
  return SALE_WORKFLOW_STAGES.find((s) => s.id === statusId) || null;
}

/**
 * Resolve a line branch id from store / customer fields.
 */
function resolveLineBranchId(...candidates) {
  for (const raw of candidates) {
    const bid = parseInt(raw, 10);
    if (Number.isFinite(bid) && bid > 0) return bid;
  }
  return 0;
}

/**
 * Build branch packs from store_entries (and customer_entries fallback).
 * One pack per distinct store/branch involved in the sale.
 */
async function ensureSaleFulfillments(
  { facilityId, saleCode, createdBy },
  transaction,
) {
  if (!db.SaleFulfillment || !db.SaleFulfillmentLine) {
    return [];
  }

  const customerLines =
    db.CustomerEntry
      ? await db.CustomerEntry.findAll({
          where: {
            facilityId,
            receiptNo: saleCode,
            type: { [Op.in]: ["sales", "service", "pro-bono"] },
          },
          transaction,
        })
      : [];

  const customerBranchBySku = new Map();
  for (const line of customerLines) {
    const sku = String(line.link_id || "").trim();
    if (!sku) continue;
    const bid = resolveLineBranchId(line.branch_id, line.branchId);
    if (bid > 0 && !customerBranchBySku.has(sku)) {
      customerBranchBySku.set(sku, bid);
    }
  }

  const storeEntries = db.StoreEntry
    ? await db.StoreEntry.findAll({
        where: {
          facilityId,
          reference_number: saleCode,
          qty_out: { [Op.gt]: 0 },
        },
        transaction,
      })
    : [];

  const byBranch = new Map();

  if (storeEntries.length) {
    const productIds = [
      ...new Set(storeEntries.map((e) => e.product_id).filter(Boolean)),
    ];
    const products = productIds.length
      ? await db.Product.findAll({
          where: { facility_id: facilityId, sku: productIds },
          attributes: ["sku", "name"],
          transaction,
        })
      : [];
    const nameBySku = new Map(products.map((p) => [p.sku, p.name]));

    for (const entry of storeEntries) {
      const sku = String(entry.product_id || "").trim();
      const bid = resolveLineBranchId(
        entry.branchId,
        entry.branch_id,
        customerBranchBySku.get(sku),
      );
      if (!byBranch.has(bid)) byBranch.set(bid, []);
      byBranch.get(bid).push({
        product_id: entry.product_id,
        item_name: nameBySku.get(entry.product_id) || entry.product_id,
        qty: Number(entry.qty_out || 0),
        store_entry_id: entry.id || null,
      });
    }
  }

  // Prefer customer line branches when store stock collapsed everything to 0
  const storeOnlyZero =
    byBranch.size > 0 &&
    [...byBranch.keys()].every((bid) => Number(bid) === 0);
  const customerHasRealBranches = [...customerBranchBySku.values()].some(
    (bid) => bid > 0,
  );

  if ((!byBranch.size || storeOnlyZero) && customerLines.length) {
    if (!byBranch.size || customerHasRealBranches) {
      byBranch.clear();
      for (const line of customerLines) {
        const bid = resolveLineBranchId(line.branch_id, line.branchId);
        if (!byBranch.has(bid)) byBranch.set(bid, []);
        byBranch.get(bid).push({
          product_id: line.link_id,
          item_name: line.description,
          qty: Number(line.qty_out || 0),
          store_entry_id: null,
        });
      }
    }
  }

  if (!byBranch.size) return [];

  return createFulfillmentsFromGroups({
    facilityId,
    saleCode,
    createdBy,
    byBranch,
    transaction,
  });
}

async function createFulfillmentsFromGroups({
  facilityId,
  saleCode,
  createdBy,
  byBranch,
  transaction,
}) {
  const realBranchIds = [...byBranch.keys()].filter((bid) => Number(bid) > 0);

  // Drop obsolete unassigned (B0) pending packs when real store packs exist
  if (realBranchIds.length && db.SaleFulfillment) {
    const orphanZero = await db.SaleFulfillment.findAll({
      where: {
        facility_id: facilityId,
        sale_code: saleCode,
        branch_id: 0,
        status: "pending",
      },
      transaction,
    });
    for (const pack of orphanZero) {
      if (db.SaleFulfillmentLine) {
        await db.SaleFulfillmentLine.destroy({
          where: { fulfillment_id: pack.id },
          transaction,
        });
      }
      await pack.destroy({ transaction });
    }
  }

  const results = [];
  for (const [branchId, lines] of byBranch.entries()) {
    const bid = Number(branchId) > 0 ? Number(branchId) : 0;
    const packCode = `${saleCode}-B${bid || "0"}`;
    const [row, created] = await db.SaleFulfillment.findOrCreate({
      where: {
        facility_id: facilityId,
        sale_code: saleCode,
        branch_id: bid,
      },
      defaults: {
        facility_id: facilityId,
        sale_code: saleCode,
        branch_id: bid,
        pack_code: packCode,
        status: "pending",
        created_by: createdBy || null,
        updated_by: createdBy || null,
      },
      transaction,
    });

    const existingLines = created
      ? []
      : await db.SaleFulfillmentLine.findAll({
          where: { fulfillment_id: row.id },
          transaction,
        });

    // Create lines on first insert, or backfill if a pending pack has none
    if (created || (row.status === "pending" && !existingLines.length)) {
      if (!created && existingLines.length === 0) {
        await db.SaleFulfillmentLine.destroy({
          where: { fulfillment_id: row.id },
          transaction,
        });
      }
      if (created || !existingLines.length) {
        await db.SaleFulfillmentLine.bulkCreate(
          lines.map((l) => ({
            fulfillment_id: row.id,
            product_id: l.product_id || null,
            item_name: l.item_name || null,
            qty: l.qty,
            qty_collected: 0,
            store_entry_id: l.store_entry_id || null,
          })),
          { transaction },
        );
      }
    }

    const withLines = await db.SaleFulfillment.findByPk(row.id, {
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
      transaction,
    });
    results.push(withLines);
  }

  // Return packs sorted by branch for stable Copy N of M display
  results.sort(
    (a, b) => Number(a.branch_id || 0) - Number(b.branch_id || 0),
  );
  return results;
}

async function enrichFulfillments(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const branchIds = [
    ...new Set(
      list
        .map((r) => parseInt(r.branch_id ?? r.branchId, 10))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const branches =
    branchIds.length && db.Branch
      ? await db.Branch.findAll({ where: { id: branchIds } })
      : [];
  const branchName = new Map(
    branches.map((b) => [b.id, b.branch_name || `Branch ${b.id}`]),
  );

  return list.map((r) => {
    const plain = r.toJSON ? r.toJSON() : r;
    const lines = plain.lines || [];
    const qtyTotal = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const qtyCollected = lines.reduce(
      (s, l) => s + Number(l.qty_collected || 0),
      0,
    );
    return {
      ...plain,
      branch_name: branchName.get(plain.branch_id) || `Branch ${plain.branch_id}`,
      qty_total: qtyTotal,
      qty_collected: qtyCollected,
      line_count: lines.length,
    };
  });
}

async function maybeAdvanceAfterAllCollected({
  facilityId,
  saleCode,
  updatedBy,
  transaction,
}) {
  const packs = await db.SaleFulfillment.findAll({
    where: { facility_id: facilityId, sale_code: saleCode },
    transaction,
  });
  if (!packs.length) return null;
  const allCollected = packs.every((p) => p.status === "collected");
  if (!allCollected) return null;

  const row = await db.SaleWorkflow.findOne({
    where: { facility_id: facilityId, sale_code: saleCode },
    transaction,
  });
  if (!row) return null;
  if (row.status === "completed") return row;

  // After warehouse collection, sale is done (collection receipt covers dual sign).
  const warehousePipeline = [
    "warehouse_picking",
    "dual_signature",
    "goods_released",
  ];
  if (!warehousePipeline.includes(row.status)) return row;

  if (row.status === "warehouse_picking") {
    row.history = pushHistory(
      row.history,
      "dual_signature",
      updatedBy,
      "All warehouse packs collected",
    );
    row.history = pushHistory(
      row.history,
      "goods_released",
      updatedBy,
      "Goods released to customer",
    );
  } else if (row.status === "dual_signature") {
    row.history = pushHistory(
      row.history,
      "goods_released",
      updatedBy,
      "Goods released to customer",
    );
  }

  row.status = "completed";
  row.history = pushHistory(
    row.history,
    "completed",
    updatedBy,
    "Sale completed after warehouse collection",
  );
  row.updated_by = updatedBy || row.updated_by;
  await row.save({ transaction });
  return row;
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

    const isPaid = paymentType !== "credit" && paymentType !== "warehouse";
  // Cash/transfer → cashier. Warehouse → separation. Credit → credit approval.
  const initialStatus = isPaid
    ? "awaiting_cashier_confirm"
    : paymentType === "warehouse"
      ? "invoice_separation"
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
      : paymentType === "warehouse"
        ? "Warehouse invoice treatment — ready for separation"
        : "Awaiting credit approval",
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

  // Packs for warehouse treatment / separation; credit packs created after approval
  if (initialStatus === "invoice_separation") {
    await ensureSaleFulfillments(
      { facilityId, saleCode, createdBy },
      transaction,
    );
  }

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
    if (status) {
      if (String(status).includes(",")) {
        where.status = {
          [Op.in]: String(status)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      } else {
        where.status = status;
      }
    }
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
      const meta = stageMeta(plain.status);
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "slate",
        next_status: next,
        next_status_label: stageMeta(next)?.label || null,
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
    const meta = stageMeta(plain.status);
    return res.json({
      success: true,
      results: {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "slate",
        next_status: next,
        next_status_label: stageMeta(next)?.label || null,
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

    let advanceNote = note;
    let next =
      action === "set_status" && forcedStatus
        ? forcedStatus
        : nextStageFor(row.status, row.payment_type);

    const isCredit =
      String(row.payment_type || "")
        .toLowerCase()
        .trim() === "credit";

    // Credit invoices cannot skip approval and jump to Separation / Warehouse
    if (
      isCredit &&
      row.status === "awaiting_credit_approval" &&
      action === "set_status" &&
      forcedStatus &&
      [
        "invoice_separation",
        "final_invoice",
        "warehouse_picking",
        "dual_signature",
        "goods_released",
        "completed",
        "payment_confirmed",
      ].includes(forcedStatus)
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Credit approval is required before this invoice can proceed to Separation",
      });
    }

    // Credit approval → land on separation (same as cashier confirm → separation)
    if (
      (!action || action === "advance") &&
      row.status === "awaiting_credit_approval" &&
      next === "credit_approved"
    ) {
      row.history = pushHistory(
        row.history,
        "credit_approved",
        updated_by,
        advanceNote || "Credit approved",
      );
      next = "invoice_separation";
      advanceNote = "Ready for invoice separation by branch";
    }

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
    row.history = pushHistory(row.history, next, updated_by, advanceNote);
    row.updated_by = updated_by || row.updated_by;
    if (next === "payment_confirmed" || next === "credit_approved") {
      row.hold_overnight = false;
    }
    if (next === "invoice_separation" && row.payment_type === "credit") {
      row.hold_overnight = false;
    }
    await row.save({ transaction });

    let fulfillments = null;
    if (
      next === "invoice_separation" ||
      next === "final_invoice" ||
      next === "warehouse_picking"
    ) {
      fulfillments = await ensureSaleFulfillments(
        {
          facilityId,
          saleCode,
          createdBy: updated_by,
        },
        transaction,
      );
      if (next === "warehouse_picking" && fulfillments?.length) {
        for (const pack of fulfillments) {
          if (pack.status === "pending") {
            pack.status = "printed";
            pack.printed_at = pack.printed_at || new Date();
            pack.updated_by = updated_by || pack.updated_by;
            await pack.save({ transaction });
          }
        }
      }
    }

    await transaction.commit();

    return res.json({
      success: true,
      message: `Advanced to ${
        SALE_WORKFLOW_STAGES.find((s) => s.id === next)?.label || next
      }`,
      results: {
        ...row.toJSON(),
        status_color: stageMeta(row.status)?.color || "slate",
        next_status: nextStageFor(row.status, row.payment_type),
        fulfillments: fulfillments
          ? await enrichFulfillments(fulfillments)
          : undefined,
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

/**
 * Cashier Point: pending invoices + today's collected cash/transfer totals.
 */
exports.getCashierDashboard = async (req, res) => {
  try {
    const { facilityId, cashierType, branchId } = req.query;
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

    const where = {
      facility_id: facilityId,
      status: ["awaiting_cashier_confirm", "awaiting_payment"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) where.branch_id = bid;
    }

    const ct = String(cashierType || "").toLowerCase();
    if (ct === "cash") {
      where.payment_type = ["cash", "split"];
    } else if (ct === "transfer") {
      where.payment_type = ["transfer", "bank", "split"];
    } else if (ct === "credit") {
      // Credit tab is loaded separately below
      where.payment_type = ["__none__"];
    } else if (ct === "split") {
      where.payment_type = ["split"];
    } else {
      where.payment_type = ["cash", "transfer", "bank", "split"];
    }

    const pending =
      ct === "credit"
        ? []
        : await db.SaleWorkflow.findAll({
            where,
            order: [["created_at", "DESC"]],
            limit: 200,
          });

    const pendingRows = pending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      const split_progress =
        String(plain.payment_type || "").toLowerCase() === "split"
          ? getSplitCollectionProgress(plain.history)
          : null;
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "amber",
        amount: Number(plain.amount) || 0,
        split_progress,
      };
    });

    // Credit sales awaiting approval (Collection Points → Credit tab)
    const creditWhere = {
      facility_id: facilityId,
      status: "awaiting_credit_approval",
      payment_type: "credit",
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) creditWhere.branch_id = bid;
    }
    const creditPending =
      ct === "cash" || ct === "transfer" || ct === "split"
        ? []
        : await db.SaleWorkflow.findAll({
            where: creditWhere,
            order: [["created_at", "DESC"]],
            limit: 200,
          });
    const creditRows = creditPending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      return {
        ...plain,
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "rose",
        amount: Number(plain.amount) || 0,
      };
    });

    const summary = {
      pending_cash: 0,
      pending_transfer: 0,
      pending_split: 0,
      pending_credit: 0,
      pending_count: pendingRows.length,
      pending_total: 0,
    };
    for (const row of pendingRows) {
      const amt = Number(row.amount) || 0;
      summary.pending_total += amt;
      const pt = String(row.payment_type || "").toLowerCase();
      if (pt === "cash") summary.pending_cash += amt;
      else if (pt === "transfer" || pt === "bank") summary.pending_transfer += amt;
      else if (pt === "split") summary.pending_split += amt;
    }
    for (const row of creditRows) {
      const amt = Number(row.amount) || 0;
      summary.pending_credit += amt;
      if (ct === "credit" || !ct) summary.pending_total += amt;
    }
    if (ct === "credit") {
      summary.pending_count = creditRows.length;
    }

    // Today's confirmed payments from customer_entries (invoice deposits)
    const todayReplacements = { facilityId };
    let branchClause = "";
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) {
        todayReplacements.branchId = bid;
        branchClause = "AND ce.branch_id = :branchId";
      }
    }

    const todayRows = await db.sequelize.query(
      `SELECT
         LOWER(TRIM(ce.mode_of_payment)) AS mode_of_payment,
         SUM(ce.cost) AS total
       FROM customer_entries ce
       WHERE ce.facilityId = :facilityId
         AND ce.type = 'deposit'
         AND ce.cost > 0
         AND DATE(ce.created_at) = CURDATE()
         AND (
           ce.description LIKE 'Sale payment%'
           OR ce.link_id LIKE 'INV-%'
           OR ce.receiptNo LIKE 'INV-%'
         )
         ${branchClause}
       GROUP BY LOWER(TRIM(ce.mode_of_payment))`,
      {
        replacements: todayReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    let collected_cash = 0;
    let collected_transfer = 0;
    for (const row of todayRows || []) {
      const mode = String(row.mode_of_payment || "").toLowerCase();
      const total = Number(row.total) || 0;
      if (mode === "cash") collected_cash += total;
      else if (mode === "bank" || mode === "transfer") collected_transfer += total;
    }

    // Confirmed workflow history (recent)
    const historyWhere = {
      facility_id: facilityId,
      status: [
        "payment_confirmed",
        "invoice_separation",
        "final_invoice",
        "warehouse_picking",
        "dual_signature",
        "goods_released",
        "completed",
        "credit_approved",
      ],
      payment_type: ["cash", "transfer", "bank", "split", "credit"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) historyWhere.branch_id = bid;
    }
    if (ct === "cash") historyWhere.payment_type = ["cash", "split"];
    else if (ct === "transfer")
      historyWhere.payment_type = ["transfer", "bank", "split"];
    else if (ct === "split") historyWhere.payment_type = ["split"];
    else if (ct === "credit") historyWhere.payment_type = ["credit"];

    const history = await db.SaleWorkflow.findAll({
      where: historyWhere,
      order: [["updated_at", "DESC"]],
      limit: 100,
    });

    return res.json({
      success: true,
      results: {
        pending: pendingRows,
        credit_pending: creditRows,
        history: history.map((r) => {
          const plain = r.toJSON();
          return {
            ...plain,
            history: normalizeHistory(plain.history),
            status_label:
              SALE_WORKFLOW_STAGES.find((s) => s.id === plain.status)?.label ||
              plain.status,
            amount: Number(plain.amount) || 0,
          };
        }),
        summary: {
          ...summary,
          collected_cash_today: collected_cash,
          collected_transfer_today: collected_transfer,
          collected_today: collected_cash + collected_transfer,
        },
      },
    });
  } catch (err) {
    console.error("getCashierDashboard:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load cashier dashboard",
    });
  }
};

/**
 * Invoice Separation queue + history of previously separated sales.
 */
exports.getSeparationDashboard = async (req, res) => {
  try {
    const { facilityId } = req.query;
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

    const pendingStatuses = [
      "payment_confirmed",
      "invoice_separation",
      "credit_approved",
      "final_invoice",
    ];
    const historyStatuses = [
      "warehouse_picking",
      "dual_signature",
      "goods_released",
      "completed",
    ];

    const mapWorkflow = (r) => {
      const plain = r.toJSON ? r.toJSON() : r;
      const meta = stageMeta(plain.status);
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "slate",
        amount: Number(plain.amount) || 0,
      };
    };

    const pending = await db.SaleWorkflow.findAll({
      where: {
        facility_id: facilityId,
        status: { [Op.in]: pendingStatuses },
      },
      order: [["updated_at", "DESC"]],
      limit: 200,
    });

    const historyRows = await db.SaleWorkflow.findAll({
      where: {
        facility_id: facilityId,
        status: { [Op.in]: historyStatuses },
      },
      order: [["updated_at", "DESC"]],
      limit: 150,
    });

    const historySaleCodes = historyRows.map((r) => r.sale_code).filter(Boolean);
    let packsBySale = new Map();
    if (historySaleCodes.length && db.SaleFulfillment) {
      const packs = await db.SaleFulfillment.findAll({
        where: {
          facility_id: facilityId,
          sale_code: { [Op.in]: historySaleCodes },
        },
        include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
        order: [["branch_id", "ASC"]],
      });
      const enriched = await enrichFulfillments(packs);
      for (const pack of enriched) {
        const key = pack.sale_code;
        if (!packsBySale.has(key)) packsBySale.set(key, []);
        packsBySale.get(key).push(pack);
      }
    }

    const history = historyRows.map((r) => {
      const mapped = mapWorkflow(r);
      const packs = packsBySale.get(mapped.sale_code) || [];
      const printedCount = packs.filter(
        (p) => p.printed_at || ["printed", "collecting", "collected"].includes(p.status),
      ).length;
      return {
        ...mapped,
        pack_count: packs.length,
        packs_printed: printedCount,
        packs,
        separated_at:
          [...normalizeHistory(mapped.history)]
            .reverse()
            .find((h) =>
              String(h.note || "")
                .toLowerCase()
                .includes("separat") ||
              h.status === "warehouse_picking",
            )?.at || mapped.updated_at || mapped.updatedAt,
      };
    });

    return res.json({
      success: true,
      results: {
        pending: pending.map(mapWorkflow),
        history,
        summary: {
          pending_count: pending.length,
          history_count: history.length,
          packs_total: history.reduce((s, r) => s + (r.pack_count || 0), 0),
        },
      },
    });
  } catch (err) {
    console.error("getSeparationDashboard:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load separation dashboard",
    });
  }
};

/**
 * Cashier collects payment for an invoice awaiting confirmation.
 * Posts Dr Cash/Bank, Cr A/R and advances workflow to payment_confirmed.
 */
exports.cashierConfirmPayment = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      saleCode,
      updated_by,
      note,
      payment_splits = [],
      cashier_type,
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
      lock: transaction.LOCK.UPDATE,
    });
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice workflow not found",
      });
    }

    if (
      row.status !== "awaiting_cashier_confirm" &&
      row.status !== "awaiting_payment"
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Invoice is not awaiting cashier payment (status: ${row.status})`,
      });
    }

    const paymentType = String(row.payment_type || "").toLowerCase();
    if (paymentType === "credit") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Credit invoices must be approved on the Credit tab at Collection Points — they cannot be collected as cash/transfer",
      });
    }
    const ct = String(cashier_type || "").toLowerCase();
    if (ct === "cash" && paymentType !== "cash" && paymentType !== "split") {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "This cashier can only collect cash payments",
      });
    }
    if (
      ct === "transfer" &&
      paymentType !== "transfer" &&
      paymentType !== "bank" &&
      paymentType !== "split"
    ) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "This cashier can only collect transfer payments",
      });
    }

    const amountDue = Number(row.amount) || 0;
    if (amountDue <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invoice amount is missing or zero",
      });
    }

    const collectionSide = String(
      req.body.collection_side || cashier_type || "",
    )
      .toLowerCase()
      .trim();
    const isSplit = paymentType === "split";
    const progress = isSplit
      ? getSplitCollectionProgress(row.history)
      : {
          cash: 0,
          transfer: 0,
          cash_done: false,
          transfer_done: false,
          collected_total: 0,
        };

    let rawSplits = Array.isArray(payment_splits)
      ? payment_splits.filter((s) => s && Number(s.amount) > 0)
      : [];
    if (!rawSplits.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Provide payment amounts (cash and/or transfer)",
      });
    }

    // Cash + Transfer: each collection point only posts its own side
    if (isSplit && (collectionSide === "cash" || collectionSide === "transfer")) {
      const sideModes =
        collectionSide === "cash"
          ? ["cash", "c"]
          : ["bank", "transfer", "bank transfer"];
      rawSplits = rawSplits.filter((s) =>
        sideModes.includes(String(s.mode || "").toLowerCase().trim()),
      );
      if (!rawSplits.length) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            collectionSide === "cash"
              ? "Cash collection point must submit a cash amount"
              : "Transfer collection point must submit a transfer amount",
        });
      }
      if (collectionSide === "cash" && progress.cash_done) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Cash portion already collected for this invoice",
        });
      }
      if (collectionSide === "transfer" && progress.transfer_done) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Transfer portion already collected for this invoice",
        });
      }
    } else {
      // Full settlement in one step (admin / both sides together)
      const splitTotal = rawSplits.reduce(
        (sum, s) => sum + (Number(s.amount) || 0),
        0,
      );
      if (Math.abs(splitTotal - amountDue) > 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Payment total (${splitTotal}) must equal amount due (${amountDue})`,
        });
      }
    }

    const portionTotal = rawSplits.reduce(
      (sum, s) => sum + (Number(s.amount) || 0),
      0,
    );
    if (portionTotal <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Payment amount must be greater than zero",
      });
    }

    if (isSplit && (collectionSide === "cash" || collectionSide === "transfer")) {
      const remaining = Number(
        (amountDue - (progress.collected_total || 0)).toFixed(2),
      );
      if (portionTotal - remaining > 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Amount exceeds remaining balance (₦${remaining.toFixed(2)})`,
        });
      }
      const otherDone =
        collectionSide === "cash"
          ? progress.transfer_done
          : progress.cash_done;
      if (!otherDone && portionTotal >= amountDue - 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Enter only your portion — leave the remainder for the other collection point (Cash or Transfer)",
        });
      }
      if (otherDone && Math.abs(portionTotal - remaining) > 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Second portion must equal remaining ₦${remaining.toFixed(2)}`,
        });
      }
    }

    const customer = await db.Customer.findOne({
      where: { customerNo: row.customer_no, facilityId },
      transaction,
    });
    if (!customer?.receivable_code) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Customer ${row.customer_no || ""} has no receivable account`,
      });
    }

    const receivableAccount = await db.AccountCategory.findOne({
      where: {
        code: customer.receivable_code,
        facility_id: facilityId,
      },
      transaction,
    });
    if (!receivableAccount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Receivable account not found: ${customer.receivable_code}`,
      });
    }

    const saleDate = new Date().toISOString().slice(0, 10);
    const saleRef = row.sale_code;
    const customerCodeLabel = row.customer_no || "";
    const branchId = row.branch_id || null;
    const ledgerEntries = [];

    for (const split of rawSplits) {
      const modeRaw = String(split.mode || "").toLowerCase().trim();
      const mode =
        modeRaw === "cash" || modeRaw === "c"
          ? "cash"
          : modeRaw === "bank" ||
              modeRaw === "transfer" ||
              modeRaw === "bank transfer"
            ? "bank"
            : null;
      if (!mode) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Each payment must be cash or bank/transfer",
        });
      }

      let accountCode = null;
      let bankAccountId = "";
      if (mode === "cash") {
        accountCode = split.accountHead?.head || split.account_code || null;
        bankAccountId = accountCode || "";
        if (!accountCode) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: "Cash account is required",
          });
        }
      } else {
        const bankId = split.bankAccount?.id || split.bank_account_id;
        if (!bankId) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: "Bank account is required for transfer",
          });
        }
        const bank = await db.bank_account.findOne({
          where: { id: bankId, facilityId, status: "active" },
          transaction,
        });
        if (!bank?.head) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: "Bank account not found or inactive",
          });
        }
        accountCode = bank.head;
        bankAccountId = String(bankId);
      }

      const payAccount = await db.AccountCategory.findOne({
        where: { code: accountCode, facility_id: facilityId },
        transaction,
      });
      if (!payAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Cash/Bank account not found: ${accountCode}`,
        });
      }

      const payAmt = Number(Number(split.amount).toFixed(2));
      const modeLabel = mode === "cash" ? "cash" : "bank";

      ledgerEntries.push({
        transaction_date: saleDate,
        account_code: payAccount.code,
        account_subhead: payAccount.parent_code || payAccount.code,
        dr: payAmt,
        cr: 0,
        account_description: payAccount.description,
        transaction_description: `Sale payment (${modeLabel}) [${customerCodeLabel}] — ${saleRef}`,
        bank_account_id: bankAccountId,
        reference_number: saleRef,
        purpose_of_payment: "Cash Sale",
        payee: `${customerCodeLabel} — ${row.customer_name || ""}`.trim(),
        mode_of_payment: modeLabel,
        created_by: updated_by || null,
        facility_id: facilityId,
        branch_id: branchId,
        status: "posted",
        type: "bank",
        transaction_ref: customerCodeLabel,
      });

      ledgerEntries.push({
        transaction_date: saleDate,
        account_code: receivableAccount.code,
        account_subhead:
          receivableAccount.parent_code || receivableAccount.code,
        dr: 0,
        cr: payAmt,
        account_description: receivableAccount.description,
        transaction_description: `Sale settlement (${modeLabel}) [${customerCodeLabel}] — ${saleRef}`,
        bank_account_id: "",
        reference_number: saleRef,
        purpose_of_payment: "Cash Sale",
        payee: `${customerCodeLabel} — ${row.customer_name || ""}`.trim(),
        mode_of_payment: modeLabel,
        created_by: updated_by || null,
        facility_id: facilityId,
        branch_id: branchId,
        status: "posted",
        type: "receivable",
        transaction_ref: customerCodeLabel,
      });

      await db.CustomerEntry.create(
        {
          customerNo: row.customer_no,
          description: `Sale payment (${modeLabel}) — ${saleRef}`,
          qty_in: 0,
          qty_out: 0,
          cost: payAmt,
          amount_paid: payAmt,
          facilityId,
          branch_id: branchId,
          mode_of_payment: modeLabel,
          link_id: saleRef,
          type: "deposit",
          receiptNo: saleRef,
          bank_account_id: bankAccountId,
          created_by: updated_by || null,
        },
        { transaction },
      );

      if (isSplit && (collectionSide === "cash" || collectionSide === "transfer")) {
        const side = collectionSide === "cash" ? "cash" : "transfer";
        row.history = pushHistory(
          row.history,
          "awaiting_cashier_confirm",
          updated_by,
          `${side === "cash" ? "Cash" : "Transfer"} portion collected ₦${payAmt.toFixed(2)}`,
          { collection: { side, amount: payAmt } },
        );
      }
    }

    await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

    const updatedProgress = isSplit
      ? getSplitCollectionProgress(row.history)
      : null;
    const fullyPaid =
      !isSplit ||
      !(collectionSide === "cash" || collectionSide === "transfer")
        ? true
        : !!(
            updatedProgress &&
            updatedProgress.cash_done &&
            updatedProgress.transfer_done &&
            Math.abs(updatedProgress.collected_total - amountDue) <= 0.05
          );

    if (fullyPaid) {
      row.status = "invoice_separation";
      row.hold_overnight = false;
      row.history = pushHistory(
        row.history,
        "payment_confirmed",
        updated_by,
        note ||
          (isSplit
            ? "Cash + Transfer fully collected — ready for separation"
            : `Payment collected by cashier (${rawSplits
                .map((s) => `${s.mode}:${s.amount}`)
                .join(", ")})`),
      );
      row.history = pushHistory(
        row.history,
        "invoice_separation",
        updated_by,
        "Ready for invoice separation by branch",
      );
      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });

      const fulfillments = await ensureSaleFulfillments(
        {
          facilityId,
          saleCode: saleRef,
          createdBy: updated_by,
        },
        transaction,
      );

      await transaction.commit();

      return res.json({
        success: true,
        message: `Payment confirmed for ${saleRef} — ready for separation`,
        results: {
          ...row.toJSON(),
          status_color: stageMeta(row.status)?.color || "violet",
          next_status: nextStageFor(row.status, row.payment_type),
          split_progress: updatedProgress,
          fulfillments: fulfillments
            ? await enrichFulfillments(fulfillments)
            : [],
        },
      });
    }

    // Partial split — stay at collection points for the other side
    row.updated_by = updated_by || row.updated_by;
    await row.save({ transaction });
    await transaction.commit();

    const waitingFor = updatedProgress?.cash_done ? "transfer" : "cash";
    return res.json({
      success: true,
      message: `${
        collectionSide === "cash" ? "Cash" : "Transfer"
      } portion recorded for ${saleRef}. Waiting for ${waitingFor} collection.`,
      results: {
        ...row.toJSON(),
        status_color: stageMeta(row.status)?.color || "amber",
        next_status: nextStageFor(row.status, row.payment_type),
        split_progress: updatedProgress,
        partial: true,
        waiting_for: waitingFor,
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("cashierConfirmPayment:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to confirm payment",
    });
  }
};


exports.listSaleFulfillments = async (req, res) => {
  try {
    const { facilityId, saleCode, branchId, status } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!db.SaleFulfillment) {
      return res.status(500).json({
        success: false,
        message: "SaleFulfillment model not loaded",
      });
    }

    const where = { facility_id: facilityId };
    if (saleCode) where.sale_code = saleCode;
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid)) where.branch_id = bid;
    }
    if (status) {
      where.status = String(status).includes(",")
        ? { [Op.in]: String(status).split(",").map((s) => s.trim()) }
        : status;
    }

    // When listing for a sale at separation, ensure packs exist (skip pre-credit)
    if (saleCode) {
      let allowEnsure = true;
      if (db.SaleWorkflow) {
        const workflow = await db.SaleWorkflow.findOne({
          where: { facility_id: facilityId, sale_code: saleCode },
          attributes: ["status", "payment_type"],
        });
        if (
          workflow &&
          workflow.status === "awaiting_credit_approval" &&
          String(workflow.payment_type || "").toLowerCase() === "credit"
        ) {
          allowEnsure = false;
        }
      }
      if (allowEnsure) {
        await ensureSaleFulfillments({
          facilityId,
          saleCode,
          createdBy: req.query.userId || null,
        });
      }
    }

    const rows = await db.SaleFulfillment.findAll({
      where,
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
      order: [
        ["branch_id", "ASC"],
        ["updated_at", "DESC"],
      ],
      limit: 300,
    });

    const results = await enrichFulfillments(rows);
    return res.json({ success: true, results, count: results.length });
  } catch (err) {
    console.error("listSaleFulfillments:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to list fulfillments",
    });
  }
};

exports.getSaleFulfillment = async (req, res) => {
  try {
    const { facilityId, packCode, id } = req.query;
    if (!facilityId || (!packCode && !id)) {
      return res.status(400).json({
        success: false,
        message: "facilityId and packCode (or id) are required",
      });
    }
    const where = { facility_id: facilityId };
    if (id) where.id = id;
    if (packCode) where.pack_code = packCode;

    const row = await db.SaleFulfillment.findOne({
      where,
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
    });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Fulfillment pack not found",
      });
    }
    const [enriched] = await enrichFulfillments([row]);
    return res.json({ success: true, results: enriched });
  } catch (err) {
    console.error("getSaleFulfillment:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to get fulfillment",
    });
  }
};

/**
 * Mark invoice separated: print all branch packs and send sale to warehouse.
 * Creates one fulfillment pack (invoice copy) per branch from stock lines.
 */
exports.completeSeparation = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, saleCode, updated_by, note } = req.body || {};
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

    const allowed = [
      "payment_confirmed",
      "invoice_separation",
      "credit_approved",
      "final_invoice",
    ];
    if (!allowed.includes(row.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Sale must be in separation (current: ${row.status})`,
      });
    }

    if (
      String(row.payment_type || "")
        .toLowerCase()
        .trim() === "credit" &&
      row.status === "awaiting_credit_approval"
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Credit approval is required at Collection Points before Invoice Separation",
      });
    }

    if (row.status === "payment_confirmed" || row.status === "credit_approved") {
      row.status = "invoice_separation";
      row.history = pushHistory(
        row.history,
        "invoice_separation",
        updated_by,
        "Ready for invoice separation by branch",
      );
    }

    const fulfillments = await ensureSaleFulfillments(
      {
        facilityId,
        saleCode,
        createdBy: updated_by,
      },
      transaction,
    );

    if (!fulfillments.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "No branch lines found for this invoice. Cannot create branch copies.",
      });
    }

    const now = new Date();
    for (const pack of fulfillments) {
      if (pack.status === "pending") {
        pack.status = "printed";
      }
      pack.printed_at = pack.printed_at || now;
      pack.updated_by = updated_by || pack.updated_by;
      await pack.save({ transaction });
    }

    const branchCount = fulfillments.length;
    row.history = pushHistory(
      row.history,
      "final_invoice",
      updated_by,
      note ||
        `Invoice separated into ${branchCount} branch cop${
          branchCount === 1 ? "y" : "ies"
        }`,
    );
    row.status = "warehouse_picking";
    row.history = pushHistory(
      row.history,
      "warehouse_picking",
      updated_by,
      "Branch invoice copies ready for warehouse collection",
    );
    row.updated_by = updated_by || row.updated_by;
    await row.save({ transaction });

    await transaction.commit();

    const enriched = await enrichFulfillments(fulfillments);
    return res.json({
      success: true,
      message: `Separated into ${branchCount} branch invoice cop${
        branchCount === 1 ? "y" : "ies"
      } — sent to warehouse`,
      results: {
        ...row.toJSON(),
        status_color: stageMeta(row.status)?.color || "slate",
        next_status: nextStageFor(row.status, row.payment_type),
        fulfillments: enriched,
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("completeSeparation:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to complete separation",
    });
  }
};

exports.markFulfillmentPrinted = async (req, res) => {
  try {
    const { facilityId, packCode, id, updated_by } = req.body || {};
    if (!facilityId || (!packCode && !id)) {
      return res.status(400).json({
        success: false,
        message: "facilityId and packCode (or id) are required",
      });
    }
    const where = { facility_id: facilityId };
    if (id) where.id = id;
    if (packCode) where.pack_code = packCode;

    const row = await db.SaleFulfillment.findOne({ where });
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Fulfillment pack not found",
      });
    }

    if (row.status === "pending") {
      row.status = "printed";
    }
    row.printed_at = new Date();
    row.updated_by = updated_by || row.updated_by;
    await row.save();

    const full = await db.SaleFulfillment.findByPk(row.id, {
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
    });
    const [enriched] = await enrichFulfillments([full]);
    return res.json({
      success: true,
      message: "Pack marked as printed",
      results: enriched,
    });
  } catch (err) {
    console.error("markFulfillmentPrinted:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to mark printed",
    });
  }
};

exports.markFulfillmentCollected = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      packCode,
      id,
      lineIds,
      collectAll,
      updated_by,
    } = req.body || {};

    if (!facilityId || (!packCode && !id)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and packCode (or id) are required",
      });
    }

    const where = { facility_id: facilityId };
    if (id) where.id = id;
    if (packCode) where.pack_code = packCode;

    const row = await db.SaleFulfillment.findOne({
      where,
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
      transaction,
    });
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Fulfillment pack not found",
      });
    }

    const lines = row.lines || [];
    const targetIds = Array.isArray(lineIds)
      ? lineIds.map((x) => Number(x))
      : [];

    for (const line of lines) {
      const shouldCollect = collectAll
        ? true
        : targetIds.length > 0
          ? targetIds.includes(Number(line.id))
          : false;
      if (shouldCollect) {
        line.qty_collected = Number(line.qty || 0);
        await line.save({ transaction });
      }
    }

    const refreshed = await db.SaleFulfillmentLine.findAll({
      where: { fulfillment_id: row.id },
      transaction,
    });
    const allDone = refreshed.every(
      (l) => Number(l.qty_collected || 0) >= Number(l.qty || 0),
    );
    const anyDone = refreshed.some((l) => Number(l.qty_collected || 0) > 0);

    if (allDone) {
      row.status = "collected";
      row.collected_at = new Date();
    } else if (anyDone) {
      row.status = "collecting";
    }
    row.updated_by = updated_by || row.updated_by;
    await row.save({ transaction });

    const workflow = await maybeAdvanceAfterAllCollected({
      facilityId,
      saleCode: row.sale_code,
      updatedBy: updated_by,
      transaction,
    });

    await transaction.commit();

    const full = await db.SaleFulfillment.findByPk(row.id, {
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
    });
    const [enriched] = await enrichFulfillments([full]);

    return res.json({
      success: true,
      message: allDone ? "Pack fully collected" : "Collection updated",
      results: enriched,
      workflow: workflow
        ? {
            sale_code: workflow.sale_code,
            status: workflow.status,
            status_color: stageMeta(workflow.status)?.color,
            next_status: nextStageFor(
              workflow.status,
              workflow.payment_type,
            ),
          }
        : null,
    });
  } catch (err) {
    await transaction.rollback();
    console.error("markFulfillmentCollected:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to mark collected",
    });
  }
};

exports.listWarehouseRequests = async (req, res) => {
  try {
    const { facilityId, branchId } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const workflowWhere = {
      facility_id: facilityId,
      status: {
        [Op.in]: ["warehouse_picking", "dual_signature"],
      },
    };

    const workflows = await db.SaleWorkflow.findAll({
      where: workflowWhere,
      order: [["updated_at", "DESC"]],
      limit: 200,
    });

    const saleCodes = workflows.map((w) => w.sale_code);
    if (!saleCodes.length) {
      return res.json({ success: true, results: [], count: 0 });
    }

    // Ensure packs for warehouse-ready sales
    for (const code of saleCodes) {
      const wf = workflows.find((w) => w.sale_code === code);
      if (wf && ["warehouse_picking"].includes(wf.status)) {
        await ensureSaleFulfillments({
          facilityId,
          saleCode: code,
        });
      }
    }

    const fulWhere = {
      facility_id: facilityId,
      sale_code: { [Op.in]: saleCodes },
      status: { [Op.ne]: "collected" },
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid)) fulWhere.branch_id = bid;
    }

    const packs = await db.SaleFulfillment.findAll({
      where: fulWhere,
      include: [{ model: db.SaleFulfillmentLine, as: "lines" }],
      order: [["updated_at", "DESC"]],
    });

    const enriched = await enrichFulfillments(packs);
    const wfByCode = new Map(
      workflows.map((w) => {
        const plain = w.toJSON();
        return [
          plain.sale_code,
          {
            ...plain,
            status_label: stageMeta(plain.status)?.label || plain.status,
            status_color: stageMeta(plain.status)?.color || "slate",
          },
        ];
      }),
    );

    const results = enriched.map((p) => ({
      ...p,
      workflow: wfByCode.get(p.sale_code) || null,
    }));

    return res.json({ success: true, results, count: results.length });
  } catch (err) {
    console.error("listWarehouseRequests:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to list warehouse requests",
    });
  }
};

const SPECIAL_TREATMENT_TYPES = ["cash", "transfer", "warehouse"];

/**
 * Special invoice treatment: switch sales between cash, transfer, and warehouse.
 * Warehouse skips cashier and goes to separation / warehouse collection.
 */
exports.applySpecialInvoiceTreatment = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      saleCodes,
      paymentType: rawType,
      updated_by,
      note,
    } = req.body;

    const paymentType = String(rawType || "")
      .toLowerCase()
      .trim();
    const codes = Array.isArray(saleCodes)
      ? [...new Set(saleCodes.map((c) => String(c || "").trim()).filter(Boolean))]
      : [];

    if (!facilityId || !codes.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and saleCodes are required",
      });
    }
    if (!SPECIAL_TREATMENT_TYPES.includes(paymentType)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "paymentType must be cash, transfer, or warehouse",
      });
    }
    if (!db.SaleWorkflow) {
      await transaction.rollback();
      return res.status(500).json({
        success: false,
        message: "SaleWorkflow model not loaded",
      });
    }

    const rows = await db.SaleWorkflow.findAll({
      where: {
        facility_id: facilityId,
        sale_code: { [Op.in]: codes },
      },
      transaction,
    });

    if (!rows.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "No matching sales found",
      });
    }

    const earlyCashier = new Set([
      "submitted",
      "awaiting_payment",
      "awaiting_cashier_confirm",
    ]);
    const earlyWarehouse = new Set([
      "invoice_separation",
      "credit_approved",
      "final_invoice",
      "payment_confirmed",
    ]);

    const updated = [];
    for (const row of rows) {
      const prevType = String(row.payment_type || "").toLowerCase();
      if (prevType === paymentType) {
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          changed: false,
        });
        continue;
      }

      row.payment_type = paymentType;
      row.history = pushHistory(
        row.history,
        row.status,
        updated_by,
        note ||
          `Special treatment: switched from ${prevType || "—"} to ${paymentType}`,
      );

      // Cash/transfer → warehouse: skip cashier, send to separation
      if (
        paymentType === "warehouse" &&
        earlyCashier.has(row.status)
      ) {
        row.status = "invoice_separation";
        row.hold_overnight = false;
        row.history = pushHistory(
          row.history,
          "invoice_separation",
          updated_by,
          "Warehouse treatment — ready for separation",
        );
        await ensureSaleFulfillments(
          {
            facilityId,
            saleCode: row.sale_code,
            createdBy: updated_by,
          },
          transaction,
        );
      }

      // Warehouse → cash/transfer: send back to cashier if not yet collected
      if (
        (paymentType === "cash" || paymentType === "transfer") &&
        earlyWarehouse.has(row.status) &&
        prevType === "warehouse"
      ) {
        row.status = "awaiting_cashier_confirm";
        row.history = pushHistory(
          row.history,
          "awaiting_cashier_confirm",
          updated_by,
          `Switched to ${paymentType} — awaiting cashier`,
        );
      }

      // Cash ↔ transfer while still at cashier
      if (
        (paymentType === "cash" || paymentType === "transfer") &&
        earlyCashier.has(row.status) &&
        (prevType === "cash" ||
          prevType === "transfer" ||
          prevType === "bank" ||
          prevType === "split")
      ) {
        // payment_type already updated; stay on cashier stage
      }

      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });
      updated.push({
        sale_code: row.sale_code,
        payment_type: row.payment_type,
        status: row.status,
        changed: true,
      });
    }

    await transaction.commit();
    return res.json({
      success: true,
      message: `Updated ${updated.filter((u) => u.changed).length} invoice(s) to ${paymentType}`,
      results: updated,
    });
  } catch (err) {
    await transaction.rollback();
    console.error("applySpecialInvoiceTreatment:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to apply special invoice treatment",
    });
  }
};
