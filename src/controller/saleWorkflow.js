const db = require("../models");
const { Op } = require("sequelize");
const moment = require("moment");
const { getCustomerLedgerBalances } = require("../utils/customerLedgerBalances");
const { isWalkInCustomer } = require("../utils/customerKind");
const {
  SALE_WORKFLOW_STAGES,
  nextStageFor,
  stagesForPaymentType,
} = require("../models/sale_workflows");

function parseModeList(paymentModes) {
  return (Array.isArray(paymentModes) ? paymentModes : [])
    .map((m) => String(m || "").toLowerCase().trim())
    .filter(Boolean);
}

function isDepositPaymentType(paymentType) {
  const t = String(paymentType || "").toLowerCase().trim();
  return t === "deposit" || t === "apply_deposit" || t === "apply deposit";
}

function normalizePaymentType(modeOfPayment, isCashSale, paymentModes = []) {
  const modes = parseModeList(paymentModes);
  const m = String(modeOfPayment || "").toLowerCase().trim();
  const hasDeposit =
    modes.includes("deposit") ||
    m === "deposit" ||
    m === "apply_deposit" ||
    m === "apply deposit" ||
    m.includes("deposit");
  const hasCash = modes.includes("cash") || m === "cash";
  const hasTransfer =
    modes.includes("transfer") || m === "transfer" || m === "bank";

  // Credit + Apply Deposit (no cash/transfer): apply deposit first
  if (hasDeposit && !hasCash && !hasTransfer) return "deposit";

  if (!isCashSale) {
    if (hasDeposit) return "deposit";
    return "credit";
  }
  if (
    m === "credit_split" ||
    m === "credit+cash+transfer" ||
    m === "credit + cash + transfer" ||
    m === "credit_cash_transfer" ||
    (modes.includes("credit") && (hasCash || hasTransfer))
  ) {
    return "credit_split";
  }
  if (
    m === "split" ||
    m === "both" ||
    m === "cash+transfer" ||
    m === "cash_transfer" ||
    m === "cash + transfer"
  ) {
    return "split";
  }
  if (m === "bank" || m === "transfer") return "transfer";
  if (m === "cash") return "cash";
  return "cash";
}

function isSplitPaymentType(paymentType) {
  const t = String(paymentType || "").toLowerCase().trim();
  return (
    t === "split" ||
    t === "both" ||
    t === "cash+transfer" ||
    t === "cash_transfer" ||
    t === "cash + transfer" ||
    t === "credit_split" ||
    t === "credit+cash+transfer" ||
    t === "credit + cash + transfer"
  );
}

function inferCollectionSideFromSplits(splits) {
  const modes = (Array.isArray(splits) ? splits : []).map((s) =>
    String(s?.mode || "").toLowerCase().trim(),
  );
  const hasCash = modes.some((m) => m === "cash" || m === "c");
  const hasBank = modes.some((m) =>
    ["bank", "transfer", "bank transfer"].includes(m),
  );
  if (hasCash && !hasBank) return "cash";
  if (hasBank && !hasCash) return "transfer";
  return "";
}

function toMoney(value) {
  if (value && typeof value === "object") return 0;
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function historyHasDiscountApproved(history) {
  return normalizeHistory(history).some((h) =>
    String(h?.note || "")
      .toLowerCase()
      .includes("discount approved"),
  );
}

function historyHasDepositApplied(history) {
  return normalizeHistory(history).some((h) =>
    /deposit applied/i.test(String(h?.note || "")),
  );
}

function historyHasCreditAfterDeposit(history) {
  return normalizeHistory(history).some((h) => {
    if (h?.credit_after_deposit === true) return true;
    const modes = parseModeList(h?.payment_modes);
    return modes.includes("credit") && modes.includes("deposit");
  });
}

async function loadDiscountBySaleCode(facilityId, saleCodes) {
  const map = new Map();
  const codes = [...new Set((saleCodes || []).map((c) => String(c || "").trim()).filter(Boolean))];
  if (!facilityId || !codes.length) return map;

  if (db.CustomerEntry) {
    const rows = await db.CustomerEntry.findAll({
      where: {
        facilityId,
        type: "discount",
        receiptNo: { [Op.in]: codes },
      },
      attributes: ["receiptNo", "cost", "description"],
    });
    for (const r of rows) {
      const code = String(r.receiptNo || "").trim();
      if (!code) continue;
      const prev = map.get(code) || {
        discount_amount: 0,
        discount_label: "",
        has_discount: false,
      };
      prev.discount_amount += toMoney(r.cost);
      if (!prev.discount_label && r.description) {
        prev.discount_label = r.description;
      }
      prev.has_discount = prev.discount_amount > 0.009;
      map.set(code, prev);
    }
  }

  const missing = codes.filter((c) => !map.has(c));
  if (missing.length && db.Invoice) {
    try {
      const invoices = await db.sequelize.query(
        `SELECT invoice_ref, description
         FROM invoices
         WHERE facility_id = :facilityId
           AND invoice_ref IN (:codes)
           AND description LIKE '%Discount%'`,
        {
          replacements: { facilityId, codes: missing },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      for (const inv of invoices || []) {
        const code = String(inv.invoice_ref || "").trim();
        if (!code || map.has(code)) continue;
        const desc = String(inv.description || "");
        const parsed =
          desc.match(/Discount:[^()]*\(([\d,.]+)\)/i) ||
          desc.match(/Discount:\s*([\d,.]+)/i);
        const amt = parsed ? toMoney(parsed[1]) : 0;
        map.set(code, {
          discount_amount: amt,
          discount_label: desc,
          has_discount: true,
        });
      }
    } catch (_) {
      /* invoices table may not have description on all rows */
    }
  }
  return map;
}

function applyDiscountMeta(row, discountMap) {
  const info = discountMap.get(String(row.sale_code || "").trim()) || {};
  const discount_amount = toMoney(info.discount_amount);
  row.discount_amount = discount_amount;
  row.discount_label = info.discount_label || "";
  row.has_discount =
    Boolean(info.has_discount) ||
    discount_amount > 0.009 ||
    historyHasDiscountApproved(row.history);
  return row;
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

/** AR outstanding vs customer.credit_limit. Limit 0 = not enforced. */
async function invoiceReceivableOnLedger(facilityId, invoiceRef) {
  if (!invoiceRef) return 0;
  const rows = await db.sequelize.query(
    `SELECT COALESCE(SUM(CASE
        WHEN LOWER(COALESCE(type, '')) IN ('receivable', 'recevable')
        THEN dr - cr ELSE 0 END), 0) AS ar
     FROM general_ledger
     WHERE facility_id = :facilityId
       AND reference_number = :invoiceRef`,
    {
      replacements: { facilityId, invoiceRef },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return Math.max(0, parseFloat(rows[0]?.ar) || 0);
}

async function getCreditLimitCheck(
  facilityId,
  customerNo,
  { extraAmount = 0, excludeInvoiceRef = null } = {},
) {
  const empty = {
    creditLimit: 0,
    outstanding: 0,
    extra: 0,
    projected: 0,
    available: null,
    unlimited: true,
    overLimit: false,
  };
  if (!facilityId || !customerNo) return empty;

  const customer = await db.Customer.findOne({
    where: { customerNo, facilityId },
    attributes: ["credit_limit", "customer_type"],
    raw: true,
  });
  if (isWalkInCustomer(customer)) {
    const extra = Math.max(0, Number(extraAmount) || 0);
    return {
      creditLimit: 0,
      outstanding: 0,
      extra,
      projected: extra,
      available: 0,
      unlimited: false,
      overLimit: extra > 0.009,
    };
  }
  const creditLimit = parseFloat(customer?.credit_limit || 0) || 0;
  const { receivables } = await getCustomerLedgerBalances(
    facilityId,
    customerNo,
  );
  let outstanding = receivables;
  if (excludeInvoiceRef) {
    const thisAr = await invoiceReceivableOnLedger(
      facilityId,
      excludeInvoiceRef,
    );
    outstanding = Math.max(0, Number((outstanding - thisAr).toFixed(2)));
  }
  const extra = Math.max(0, Number(extraAmount) || 0);
  const projected = Number((outstanding + extra).toFixed(2));
  const unlimited = !(creditLimit > 0);
  const available = unlimited
    ? null
    : Math.max(0, Number((creditLimit - outstanding).toFixed(2)));
  const overLimit = !unlimited && projected > creditLimit + 0.01;
  return {
    creditLimit,
    outstanding,
    extra,
    projected,
    available,
    unlimited,
    overLimit,
  };
}

async function assertCreditLimitMessage(
  facilityId,
  customerNo,
  opts = {},
) {
  const check = await getCreditLimitCheck(facilityId, customerNo, opts);
  if (!check.overLimit) return null;
  const thisBit =
    check.extra > 0.009 ? `, This invoice: ${check.extra.toFixed(2)}` : "";
  return `Credit limit exceeded. Limit: ${check.creditLimit.toFixed(
    2,
  )}, Other outstanding: ${check.outstanding.toFixed(
    2,
  )}${thisBit}, Projected: ${check.projected.toFixed(2)}`;
}

/** Latest unresolved payment-mode switch request from history. */
function getPendingPaymentMode(history) {
  const list = normalizeHistory(history);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const h = list[i];
    if (h?.pending_payment_mode_resolved) return null;
    if (h?.pending_payment_mode?.to) return h.pending_payment_mode;
  }
  return null;
}

function normalizeSpecialPaymentType(rawType) {
  let paymentType = String(rawType || "")
    .toLowerCase()
    .trim();
  if (paymentType === "bank") paymentType = "transfer";
  if (
    paymentType === "both" ||
    paymentType === "cash+transfer" ||
    paymentType === "cash + transfer"
  ) {
    paymentType = "split";
  }
  return paymentType;
}

/**
 * Apply a payment_type change and related status transitions on a workflow row.
 * Mutates row; caller saves.
 */
async function applyPaymentTypeToWorkflow(
  row,
  {
    facilityId,
    paymentType,
    updated_by,
    note,
  },
  transaction,
) {
  const prevType = String(row.payment_type || "").toLowerCase();
  const earlyCashier = new Set([
    "submitted",
    "awaiting_payment",
    "awaiting_cashier_confirm",
    "awaiting_credit_approval",
    "awaiting_discount_approval",
    "awaiting_payment_mode_approval",
  ]);
  const earlyWarehouse = new Set([
    "invoice_separation",
    "credit_approved",
    "final_invoice",
    "payment_confirmed",
  ]);
  const paidLike = new Set([
    "cash",
    "transfer",
    "bank",
    "split",
    "credit_split",
  ]);

  if (
    [
      "warehouse_picking",
      "dual_signature",
      "goods_released",
      "completed",
    ].includes(String(row.status || ""))
  ) {
    return { changed: false, skipped: true, reason: "Sale already in fulfillment" };
  }

  if (prevType === paymentType) {
    return { changed: false, skipped: false };
  }

  row.payment_type = paymentType;
  row.history = pushHistory(
    row.history,
    row.status,
    updated_by,
    note ||
      `Payment mode switched from ${prevType || "—"} to ${paymentType}`,
  );

  if (paymentType === "warehouse" && earlyCashier.has(row.status)) {
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

  if (
    paymentType === "credit" &&
    (earlyCashier.has(row.status) || earlyWarehouse.has(row.status))
  ) {
    // Credit must always wait for Credit Approval before Invoice Separation
    row.status = "awaiting_credit_approval";
    row.history = pushHistory(
      row.history,
      "awaiting_credit_approval",
      updated_by,
      "Switched to credit — must be approved on Credit tab before Invoice Separation",
    );
  }

  if (paymentType === "deposit" && earlyCashier.has(row.status)) {
    row.status = "awaiting_payment";
    row.history = pushHistory(
      row.history,
      "awaiting_payment",
      updated_by,
      "Switched to Apply Deposit — apply customer deposit before collection or credit approval",
    );
  }

  if (
    paidLike.has(paymentType) &&
    paymentType !== "credit" &&
    (earlyWarehouse.has(row.status) ||
      row.status === "awaiting_credit_approval" ||
      earlyCashier.has(row.status))
  ) {
    if (
      row.status !== "awaiting_discount_approval" &&
      row.status !== "awaiting_cashier_confirm"
    ) {
      row.status = "awaiting_cashier_confirm";
      row.history = pushHistory(
        row.history,
        "awaiting_cashier_confirm",
        updated_by,
        `Switched to ${paymentType} — awaiting cashier`,
      );
    }
  }

  row.updated_by = updated_by || row.updated_by;
  return { changed: true, skipped: false };
}

/** Latest credit remainder payload from Credit + Cash + Transfer flow. */
function getCreditRemainderFromHistory(history) {
  const list = normalizeHistory(history);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const cr = list[i]?.credit_remainder;
    if (cr && Number(cr.remainder) > 0) return cr;
  }
  return null;
}

/** Track partial Cash + Transfer collections on split invoices. */
function getSplitCollectionProgress(history) {
  const list = normalizeHistory(history);
  let cash = 0;
  let transfer = 0;
  let cash_by = null;
  let transfer_by = null;
  let cash_by_name = null;
  let transfer_by_name = null;
  let cash_at = null;
  let transfer_at = null;
  for (const h of list) {
    const side = String(h?.collection?.side || "").toLowerCase();
    const amt = Number(h?.collection?.amount) || 0;
    if (!amt) continue;
    const byName =
      h?.collection?.by_name ||
      h?.by_name ||
      null;
    if (side === "cash") {
      cash += amt;
      cash_by = h.by || cash_by;
      // Prefer latest collector name on this side
      if (byName) cash_by_name = byName;
      cash_at = h.at || cash_at;
    } else if (side === "transfer" || side === "bank") {
      transfer += amt;
      transfer_by = h.by || transfer_by;
      if (byName) transfer_by_name = byName;
      transfer_at = h.at || transfer_at;
    }
  }
  const collected_total = Number((cash + transfer).toFixed(2));
  const creditRem = getCreditRemainderFromHistory(history);
  const creditFromHistory =
    creditRem != null ? Number(creditRem.remainder) || 0 : null;
  return {
    cash: Number(cash.toFixed(2)),
    transfer: Number(transfer.toFixed(2)),
    cash_done: cash > 0.05,
    transfer_done: transfer > 0.05,
    cash_by,
    transfer_by,
    cash_by_name,
    transfer_by_name,
    cash_at,
    transfer_at,
    collected_total,
    credit:
      creditFromHistory != null
        ? Number(creditFromHistory.toFixed(2))
        : null,
    original_amount:
      creditRem?.original_amount != null
        ? Number(creditRem.original_amount)
        : null,
  };
}

/** Attach split/credit progress for credit_split and credit-remainder rows. */
function buildSplitProgressForRow(plain) {
  const pt = String(plain?.payment_type || "").toLowerCase();
  const progress = getSplitCollectionProgress(plain?.history);
  const creditRem = getCreditRemainderFromHistory(plain?.history);
  const amountDue = Number(plain?.amount) || 0;
  if (pt === "credit_split") {
    const credit = Number(
      (amountDue - (progress.collected_total || 0)).toFixed(2),
    );
    return {
      ...progress,
      credit: credit > 0.05 ? credit : 0,
      original_amount: amountDue,
    };
  }
  if (pt === "credit" && (creditRem || progress.collected_total > 0.05)) {
    return {
      ...progress,
      credit:
        progress.credit != null
          ? progress.credit
          : Number(amountDue.toFixed(2)),
      original_amount:
        progress.original_amount != null
          ? progress.original_amount
          : Number(
              (
                (progress.collected_total || 0) + amountDue
              ).toFixed(2),
            ),
    };
  }
  if (isSplitPaymentType(pt)) {
    return progress;
  }
  return null;
}

/** Persist workflow history JSON (Sequelize may miss nested mutations). */
function setWorkflowHistory(row, nextHistory) {
  const value = normalizeHistory(nextHistory);
  row.set("history", value);
  if (typeof row.changed === "function") {
    row.changed("history", true);
  }
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
 * Discounted sales → awaiting discount approval (before cashier/credit).
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
    discountAmount = 0,
    assignedCashierId = null,
    assignedCashierName = null,
    paymentModes = [],
  },
  transaction,
) {
  if (!db.SaleWorkflow || !facilityId || !saleCode) return null;

  const modes = parseModeList(paymentModes);
  let resolvedPaymentType = paymentType;
  const creditAfterDeposit =
    isDepositPaymentType(resolvedPaymentType) && modes.includes("credit");
  const isPaid =
    resolvedPaymentType !== "credit" &&
    resolvedPaymentType !== "warehouse" &&
    !isDepositPaymentType(resolvedPaymentType);
  const hasDiscount = toMoney(discountAmount) > 0;
  const depositFullyApplied =
    isDepositPaymentType(resolvedPaymentType) && Number(amount) <= 0;
  const cashierId =
    assignedCashierId != null && String(assignedCashierId).trim()
      ? String(assignedCashierId).trim()
      : null;
  const cashierName =
    assignedCashierName != null && String(assignedCashierName).trim()
      ? String(assignedCashierName).trim()
      : null;

  let availableDeposit = 0;
  if (isDepositPaymentType(resolvedPaymentType) && customerNo) {
    try {
      const bals = await getCustomerLedgerBalances(facilityId, customerNo);
      availableDeposit = Number(bals?.deposit) || 0;
    } catch (_) {
      availableDeposit = 0;
    }
  }

  // Discounted invoices must be approved before Verification Points / credit path
  let initialStatus;
  let statusNote;
  if (hasDiscount && !isDepositPaymentType(resolvedPaymentType)) {
    initialStatus = "awaiting_discount_approval";
    statusNote = "Awaiting discount approval before collection";
  } else if (isDepositPaymentType(resolvedPaymentType)) {
    if (depositFullyApplied || Number(amount) === 0) {
      initialStatus = "invoice_separation";
      statusNote = "Deposit applied — ready for separation";
    } else if (creditAfterDeposit && availableDeposit <= 0.05) {
      // Credit + Apply Deposit with nothing to apply — go to Credit, not a cashier queue
      resolvedPaymentType = "credit";
      initialStatus = "awaiting_credit_approval";
      statusNote =
        "No customer deposit available — awaiting credit approval";
    } else {
      // Do not send to Credit Approval yet — user applies deposit first
      initialStatus = "awaiting_payment";
      statusNote = creditAfterDeposit
        ? "Awaiting Apply Deposit — apply customer deposit, remainder goes to Credit approval"
        : "Awaiting Apply Deposit — apply customer deposit before separation or credit approval";
    }
  } else if (isPaid) {
    initialStatus = "awaiting_cashier_confirm";
    statusNote =
      paymentType === "credit_split"
        ? "Awaiting cash + transfer collection (credit remainder)"
        : cashierName
          ? `Awaiting cashier payment confirmation (${cashierName})`
          : "Awaiting cashier payment confirmation";
  } else if (paymentType === "warehouse") {
    initialStatus = "invoice_separation";
    statusNote = "Warehouse invoice treatment — ready for separation";
  } else {
    initialStatus = "awaiting_credit_approval";
    statusNote = "Awaiting credit approval";
  }

  let history = [];
  const historyExtra = {
    ...(modes.length ? { payment_modes: modes } : {}),
    ...(creditAfterDeposit ? { credit_after_deposit: true } : {}),
  };
  history = pushHistory(history, "sales_order", createdBy, "Order created");
  history = pushHistory(history, "invoice_generated", createdBy, "Invoice generated");
  history = pushHistory(history, "submitted", createdBy, "Submitted for processing");
  history = pushHistory(
    history,
    initialStatus,
    createdBy,
    statusNote,
    Object.keys(historyExtra).length ? historyExtra : null,
  );
  if (cashierId && isPaid) {
    history = pushHistory(
      history,
      initialStatus,
      createdBy,
      `Assigned cashier user id ${cashierId}${cashierName ? ` (${cashierName})` : ""}`,
    );
  }

  const [row, created] = await db.SaleWorkflow.findOrCreate({
    where: { facility_id: facilityId, sale_code: saleCode },
    defaults: {
      facility_id: facilityId,
      sale_code: saleCode,
      customer_no: customerNo || null,
      customer_name: customerName || null,
      payment_type: resolvedPaymentType,
      status: initialStatus,
      amount: amount != null ? Number(amount) : null,
      branch_id: branchId || null,
      assigned_cashier_id: isPaid ? cashierId : null,
      assigned_cashier_name: isPaid ? cashierName : null,
      hold_overnight: Boolean(holdOvernight),
      history,
      created_by: createdBy || null,
      updated_by: createdBy || null,
    },
    transaction,
  });

  // Existing row may have skipped discount approval (created before discount was posted).
  if (
    !created &&
    hasDiscount &&
    !isDepositPaymentType(resolvedPaymentType) &&
    [
      "awaiting_credit_approval",
      "awaiting_cashier_confirm",
      "awaiting_payment",
    ].includes(row.status)
  ) {
    row.status = "awaiting_discount_approval";
    row.history = pushHistory(
      row.history,
      "awaiting_discount_approval",
      createdBy,
      "Awaiting discount approval before collection",
    );
    row.updated_by = createdBy || row.updated_by;
    await row.save({ transaction });
  }

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

    if (action === "send_remainder_to_credit") {
      const pt = String(row.payment_type || "")
        .toLowerCase()
        .trim();
      if (
        !isDepositPaymentType(pt) ||
        !["awaiting_payment", "awaiting_cashier_confirm"].includes(
          String(row.status || ""),
        )
      ) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invoice is not waiting for a deposit application",
        });
      }
      row.payment_type = "credit";
      row.status = "awaiting_credit_approval";
      row.history = pushHistory(
        row.history,
        "awaiting_credit_approval",
        updated_by,
        note ||
          "Remainder sent to Credit approval (Apply Deposit skipped or none available)",
        { credit_after_deposit: true },
      );
      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });
      await transaction.commit();
      return res.json({
        success: true,
        message: "Remainder sent to Credit approval",
        results: row,
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

    // Approve / reject payment mode switch (Verification Points)
    if (
      row.status === "awaiting_payment_mode_approval" &&
      (!action || action === "advance" || action === "reject_payment_mode")
    ) {
      const pending = getPendingPaymentMode(row.history);
      if (!pending?.to) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "No pending payment mode change to approve",
        });
      }

      if (action === "reject_payment_mode") {
        const restore = pending.previous_status || "awaiting_cashier_confirm";
        row.history = pushHistory(
          row.history,
          restore,
          updated_by,
          note ||
            `Payment mode switch to ${pending.to} rejected — restored ${restore}`,
          { pending_payment_mode_resolved: true, rejected: true },
        );
        row.status = restore;
        row.updated_by = updated_by || row.updated_by;
        await row.save({ transaction });
        await transaction.commit();
        return res.json({
          success: true,
          message: "Payment mode switch rejected",
          results: row,
        });
      }

      const applied = await applyPaymentTypeToWorkflow(
        row,
        {
          facilityId,
          paymentType: normalizeSpecialPaymentType(pending.to),
          updated_by,
          note:
            advanceNote ||
            `Payment mode switch approved: ${pending.from || "—"} → ${pending.to}`,
        },
        transaction,
      );
      if (applied.skipped) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: applied.reason || "Cannot apply payment mode switch",
        });
      }
      row.history = pushHistory(
        row.history,
        row.status,
        updated_by,
        advanceNote || "Payment mode switch approved",
        { pending_payment_mode_resolved: true, approved: true },
      );
      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });
      await transaction.commit();
      return res.json({
        success: true,
        message: `Payment mode switched to ${row.payment_type}`,
        results: row,
      });
    }

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
      const limitErr = await assertCreditLimitMessage(
        facilityId,
        row.customer_no,
        {
          extraAmount: Number(row.amount) || 0,
          excludeInvoiceRef: row.sale_code,
        },
      );
      if (limitErr) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: limitErr,
        });
      }
      row.history = pushHistory(
        row.history,
        "credit_approved",
        updated_by,
        advanceNote || "Credit approved",
      );
      next = "invoice_separation";
      advanceNote =
        "Credit approved — sent to Invoice Separation (approval required before separation)";
    }

    // Credit must never skip approval and jump to Separation / Warehouse
    if (
      isCredit &&
      (!action || action === "advance" || action === "set_status") &&
      [
        "invoice_separation",
        "final_invoice",
        "warehouse_picking",
        "dual_signature",
        "goods_released",
        "completed",
        "payment_confirmed",
      ].includes(next) &&
      row.status !== "awaiting_credit_approval" &&
      row.status !== "credit_approved" &&
      !normalizeHistory(row.history).some(
        (h) => String(h?.status || "") === "credit_approved",
      )
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Credit invoices must be approved on the Credit tab at Verification Points before Invoice Separation",
      });
    }

    // Discount approval → release to cashier (or credit approval for credit sales)
    if (
      row.status === "awaiting_discount_approval" &&
      (!action || action === "advance" || action === "approve_discount")
    ) {
      next = nextStageFor("awaiting_discount_approval", row.payment_type);
      advanceNote =
        next === "awaiting_credit_approval"
          ? advanceNote ||
            "Discount approved — awaiting credit approval"
          : advanceNote ||
            "Discount approved — ready for Verification Points";
    } else if (action === "approve_discount") {
      row.history = pushHistory(
        row.history,
        row.status,
        updated_by,
        advanceNote || "Discount approved",
      );
      row.updated_by = updated_by || row.updated_by;
      await row.save({ transaction });
      await transaction.commit();
      return res.json({
        success: true,
        message: "Discount approved",
        results: row,
      });
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
    const {
      facilityId,
      cashierType,
      branchId,
      userId,
      role,
      historyFrom,
      historyTo,
      fromDate,
      toDate,
    } = req.query;
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

    const todayYmd = moment().format("YYYY-MM-DD");
    const parseYmd = (v) => {
      const s = String(v || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      return s;
    };
    let histFrom =
      parseYmd(historyFrom) || parseYmd(fromDate) || todayYmd;
    let histTo = parseYmd(historyTo) || parseYmd(toDate) || histFrom;
    if (histFrom > histTo) {
      const tmp = histFrom;
      histFrom = histTo;
      histTo = tmp;
    }

    const createdToday = db.sequelize.where(
      db.sequelize.fn("DATE", db.sequelize.col("created_at")),
      todayYmd,
    );
    const withCreatedToday = (clause) => ({
      ...clause,
      [Op.and]: [
        ...(Array.isArray(clause[Op.and])
          ? clause[Op.and]
          : clause[Op.and]
            ? [clause[Op.and]]
            : []),
        createdToday,
      ],
    });

    const where = {
      facility_id: facilityId,
      status: ["awaiting_cashier_confirm", "awaiting_payment"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) where.branch_id = bid;
    }

    // Cashiers see invoices assigned to them, or unassigned (open pool)
    const roleNorm = String(role || "")
      .toLowerCase()
      .trim();
    const isCashierRole =
      roleNorm === "cashier" ||
      roleNorm === "casher" ||
      roleNorm.includes("cashier") ||
      roleNorm.includes("casher");
    const cashierUserId =
      userId != null && String(userId).trim() ? String(userId).trim() : "";
    if (isCashierRole && cashierUserId) {
      where[db.Sequelize.Op.or] = [
        { assigned_cashier_id: cashierUserId },
        { assigned_cashier_id: null },
        { assigned_cashier_id: "" },
      ];
    }

    const ct = String(cashierType || "").toLowerCase();
    if (ct === "cash") {
      where.payment_type = ["cash", "split", "credit_split"];
    } else if (ct === "transfer") {
      where.payment_type = ["transfer", "bank", "split", "credit_split"];
    } else if (ct === "credit") {
      // Credit tab is loaded separately below
      where.payment_type = ["__none__"];
    } else if (ct === "split") {
      where.payment_type = ["split", "credit_split"];
    } else if (ct === "deposit") {
      where.payment_type = ["__none__"];
    } else {
      where.payment_type = ["cash", "transfer", "bank", "split", "credit_split"];
    }

    const pending =
      ct === "credit"
        ? []
        : await db.SaleWorkflow.findAll({
            where: withCreatedToday(where),
            order: [["created_at", "DESC"]],
            limit: 200,
          });

    const pendingRows = pending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      const split_progress = buildSplitProgressForRow(plain);
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "amber",
        amount: Number(plain.amount) || 0,
        split_progress,
      };
    });

    // Resolve collector display names for split progress (when only user id stored)
    const collectorIds = new Set();
    pendingRows.forEach((r) => {
      if (r.split_progress?.cash_by) collectorIds.add(String(r.split_progress.cash_by));
      if (r.split_progress?.transfer_by)
        collectorIds.add(String(r.split_progress.transfer_by));
    });

    // Credit sales awaiting approval (Verification Points → Credit tab)
    // Fresh Apply Deposit invoices use awaiting_payment — only deposit remainders land here
    const creditWhere = {
      facility_id: facilityId,
      status: "awaiting_credit_approval",
      payment_type: ["credit", "deposit"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) creditWhere.branch_id = bid;
    }
    const creditPending =
      ct === "cash" ||
      ct === "transfer" ||
      ct === "split" ||
      ct === "discount" ||
      ct === "mode" ||
      ct === "deposit"
        ? []
        : await db.SaleWorkflow.findAll({
            where: withCreatedToday(creditWhere),
            order: [["created_at", "DESC"]],
            limit: 200,
          });
    const creditRows = [];
    for (const r of creditPending) {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      const split_progress = buildSplitProgressForRow(plain);
      const check = await getCreditLimitCheck(facilityId, plain.customer_no, {
        extraAmount: Number(plain.amount) || 0,
        excludeInvoiceRef: plain.sale_code,
      });
      creditRows.push({
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "rose",
        amount: Number(plain.amount) || 0,
        split_progress,
        credit_limit: check.creditLimit,
        credit_outstanding: check.outstanding,
        credit_available: check.available,
        credit_projected: check.projected,
        credit_unlimited: check.unlimited,
        credit_over_limit: check.overLimit,
      });
    }
    creditRows.forEach((r) => {
      if (r.split_progress?.cash_by)
        collectorIds.add(String(r.split_progress.cash_by));
      if (r.split_progress?.transfer_by)
        collectorIds.add(String(r.split_progress.transfer_by));
    });

    if (collectorIds.size && db.users) {
      try {
        const users = await db.users.findAll({
          where: { id: [...collectorIds] },
          attributes: ["id", "firstname", "lastname", "username"],
        });
        const nameById = {};
        users.forEach((u) => {
          nameById[String(u.id)] =
            [u.firstname, u.lastname].filter(Boolean).join(" ").trim() ||
            u.username ||
            String(u.id);
        });
        const applyNames = (r) => {
          if (!r.split_progress) return;
          if (!r.split_progress.cash_by_name && r.split_progress.cash_by) {
            r.split_progress.cash_by_name =
              nameById[String(r.split_progress.cash_by)] || null;
          }
          if (
            !r.split_progress.transfer_by_name &&
            r.split_progress.transfer_by
          ) {
            r.split_progress.transfer_by_name =
              nameById[String(r.split_progress.transfer_by)] || null;
          }
        };
        pendingRows.forEach(applyNames);
        creditRows.forEach(applyNames);
      } catch (_) {
        /* ignore name lookup failures */
      }
    }

    const depositWhere = {
      facility_id: facilityId,
      status: ["awaiting_payment", "awaiting_cashier_confirm"],
      payment_type: ["deposit", "apply_deposit"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) depositWhere.branch_id = bid;
    }
    const depositPending =
      ct === "cash" ||
      ct === "transfer" ||
      ct === "split" ||
      ct === "credit" ||
      ct === "discount" ||
      ct === "mode"
        ? []
        : await db.SaleWorkflow.findAll({
            where: depositWhere,
            order: [["created_at", "DESC"]],
            limit: 200,
          });
    const depositRows = depositPending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      const history = normalizeHistory(plain.history);
      return {
        ...plain,
        history,
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "teal",
        amount: Number(plain.amount) || 0,
        credit_after_deposit: historyHasCreditAfterDeposit(history),
      };
    });

    const depositCustomerNos = [
      ...new Set(depositRows.map((r) => r.customer_no).filter(Boolean)),
    ];
    const depositBalByCustomer = new Map();
    await Promise.all(
      depositCustomerNos.map(async (cno) => {
        try {
          const bals = await getCustomerLedgerBalances(facilityId, cno);
          depositBalByCustomer.set(String(cno), Number(bals?.deposit) || 0);
        } catch (_) {
          depositBalByCustomer.set(String(cno), 0);
        }
      }),
    );
    for (const row of depositRows) {
      row.deposit_available =
        depositBalByCustomer.get(String(row.customer_no || "")) || 0;
      row.credit_remainder = Number(
        Math.max(
          0,
          (Number(row.amount) || 0) - (Number(row.deposit_available) || 0),
        ).toFixed(2),
      );
    }

    // Discounted invoices awaiting approval before Verification Points
    const discountWhere = {
      facility_id: facilityId,
      status: "awaiting_discount_approval",
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) discountWhere.branch_id = bid;
    }
    const discountPending =
      ct === "cash" ||
      ct === "transfer" ||
      ct === "split" ||
      ct === "credit" ||
      ct === "mode" ||
      ct === "deposit"
        ? []
        : await db.SaleWorkflow.findAll({
            where: discountWhere,
            order: [["created_at", "DESC"]],
            limit: 200,
          });
    const discountRows = discountPending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "orange",
        amount: Number(plain.amount) || 0,
      };
    });

    // Payment mode switch requests awaiting approval
    const modeWhere = {
      facility_id: facilityId,
      status: "awaiting_payment_mode_approval",
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) modeWhere.branch_id = bid;
    }
    const modePending =
      ct === "cash" ||
      ct === "transfer" ||
      ct === "split" ||
      ct === "credit" ||
      ct === "discount" ||
      ct === "deposit"
        ? []
        : await db.SaleWorkflow.findAll({
            where: withCreatedToday(modeWhere),
            order: [["updated_at", "DESC"], ["created_at", "DESC"]],
            limit: 200,
          });
    const modeRows = modePending.map((r) => {
      const plain = r.toJSON();
      const meta = stageMeta(plain.status);
      const pending_mode = getPendingPaymentMode(plain.history);
      return {
        ...plain,
        history: normalizeHistory(plain.history),
        status_label: meta?.label || plain.status,
        status_color: meta?.color || "indigo",
        amount: Number(plain.amount) || 0,
        pending_payment_mode: pending_mode,
        proposed_payment_type: pending_mode?.to || null,
      };
    });

    // Tag queues with posted discounts; pull skipped discounted invoices into Discount tab
    const queueCodes = [
      ...pendingRows,
      ...creditRows,
      ...depositRows,
      ...discountRows,
    ]
      .map((r) => r.sale_code)
      .filter(Boolean);
    let todayDiscountCodes = [];
    if (db.CustomerEntry) {
      const todayDiscounts = await db.CustomerEntry.findAll({
        where: {
          facilityId,
          type: "discount",
          [Op.and]: [
            db.sequelize.where(
              db.sequelize.fn("DATE", db.sequelize.col("created_at")),
              todayYmd,
            ),
          ],
        },
        attributes: ["receiptNo", "cost", "description"],
      });
      todayDiscountCodes = todayDiscounts
        .map((r) => String(r.receiptNo || "").trim())
        .filter(Boolean);
    }
    const discountMap = await loadDiscountBySaleCode(facilityId, [
      ...queueCodes,
      ...todayDiscountCodes,
    ]);
    [...pendingRows, ...creditRows, ...depositRows, ...discountRows].forEach(
      (row) => applyDiscountMeta(row, discountMap),
    );

    const extraDiscountCodes = todayDiscountCodes.filter(
      (code) => !queueCodes.includes(code),
    );
    if (extraDiscountCodes.length) {
      const extraWhere = {
        facility_id: facilityId,
        sale_code: extraDiscountCodes,
        status: [
          "awaiting_discount_approval",
          "awaiting_credit_approval",
          "awaiting_cashier_confirm",
          "awaiting_payment",
        ],
      };
      if (branchId && branchId !== "all") {
        const bid = parseInt(branchId, 10);
        if (Number.isFinite(bid) && bid > 0) extraWhere.branch_id = bid;
      }
      const extraRows = await db.SaleWorkflow.findAll({
        where: extraWhere,
        order: [["created_at", "DESC"]],
        limit: 200,
      });
      for (const r of extraRows) {
        const code = String(r.sale_code || "").trim();
        if (discountRows.some((d) => String(d.sale_code) === code)) continue;
        const plain = r.toJSON();
        const meta = stageMeta(plain.status);
        discountRows.push(
          applyDiscountMeta(
            {
              ...plain,
              history: normalizeHistory(plain.history),
              status_label: meta?.label || plain.status,
              status_color: meta?.color || "orange",
              amount: Number(plain.amount) || 0,
            },
            discountMap,
          ),
        );
      }
    }

    const HOLD_FOR_DISCOUNT = new Set([
      "awaiting_discount_approval",
      "awaiting_credit_approval",
      "awaiting_cashier_confirm",
      "awaiting_payment",
    ]);
    const shouldHoldForDiscount = (row) =>
      row.status === "awaiting_discount_approval" ||
      (row.has_discount &&
        !historyHasDiscountApproved(row.history) &&
        HOLD_FOR_DISCOUNT.has(row.status));

    const pullIntoDiscount = (list) => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const row = list[i];
        const pt = String(row.payment_type || "").toLowerCase();
        if (pt === "deposit" || pt === "apply_deposit") continue;
        if (!shouldHoldForDiscount(row)) continue;
        if (
          !discountRows.some((d) => String(d.sale_code) === String(row.sale_code))
        ) {
          discountRows.push(row);
        }
        if (row.status !== "awaiting_discount_approval") {
          list.splice(i, 1);
        }
      }
    };
    pullIntoDiscount(pendingRows);
    pullIntoDiscount(creditRows);
    pullIntoDiscount(depositRows);

    // Credit + Apply Deposit stays on Apply Deposit until applied, and also
    // lists on Credit so the credit remainder is visible immediately.
    const listOnCreditTab = (row) =>
      Boolean(row.credit_after_deposit) ||
      Number(row.credit_remainder) > 0.05;
    if (
      ct !== "cash" &&
      ct !== "transfer" &&
      ct !== "split" &&
      ct !== "discount" &&
      ct !== "mode" &&
      ct !== "deposit"
    ) {
      for (const row of depositRows) {
        if (!listOnCreditTab(row)) continue;
        if (
          creditRows.some(
            (c) => String(c.sale_code) === String(row.sale_code),
          )
        ) {
          continue;
        }
        const remainder = Number(row.credit_remainder) || 0;
        const extraAmount =
          remainder > 0.05 ? remainder : Number(row.amount) || 0;
        const check = await getCreditLimitCheck(facilityId, row.customer_no, {
          extraAmount,
          excludeInvoiceRef: row.sale_code,
        });
        creditRows.push({
          ...row,
          deposit_pending: true,
          credit_after_deposit: true,
          status_label:
            remainder > 0.05
              ? "Credit after deposit"
              : "Covered by deposit",
          status_color: remainder > 0.05 ? "rose" : "teal",
          credit_limit: check.creditLimit,
          credit_outstanding: check.outstanding,
          credit_available: check.available,
          credit_projected: check.projected,
          credit_unlimited: check.unlimited,
          credit_over_limit: check.overLimit,
        });
      }
    }

    const summary = {
      pending_cash: 0,
      pending_transfer: 0,
      pending_split: 0,
      pending_credit: 0,
      pending_deposit: 0,
      pending_discount: 0,
      pending_mode: 0,
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
    for (const row of depositRows) {
      const amt = Number(row.amount) || 0;
      summary.pending_deposit += amt;
      if (ct === "deposit" || !ct) summary.pending_total += amt;
    }
    for (const row of discountRows) {
      const amt = Number(row.amount) || 0;
      summary.pending_discount += amt;
      if (ct === "discount" || !ct) summary.pending_total += amt;
    }
    for (const row of modeRows) {
      const amt = Number(row.amount) || 0;
      summary.pending_mode += amt;
      if (ct === "mode" || !ct) summary.pending_total += amt;
    }
    if (ct === "credit") {
      summary.pending_count = creditRows.length;
    } else if (ct === "deposit") {
      summary.pending_count = depositRows.length;
    } else if (ct === "discount") {
      summary.pending_count = discountRows.length;
    } else if (ct === "mode") {
      summary.pending_count = modeRows.length;
    }

    // Today's confirmed payments from customer_entries (invoice collections + advances)
    // Use history date range so summary cards match History fetch
    const todayReplacements = {
      facilityId,
      histFrom,
      histTo,
    };
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
         AND DATE(ce.created_at) BETWEEN :histFrom AND :histTo
         AND (
           ce.description LIKE 'Sale payment%'
           OR ce.link_id LIKE 'INV-%'
           OR ce.receiptNo LIKE 'INV-%'
           OR ce.receiptNo LIKE 'AD-%'
           OR ce.description LIKE '%advance%'
           OR ce.description LIKE '%Advance%'
           OR ce.description LIKE '%Verification Points advance%' OR ce.description LIKE '%Collection Points advance%'
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
      else if (
        mode === "bank" ||
        mode === "transfer" ||
        mode === "bank transfer" ||
        mode === "cheque"
      ) {
        collected_transfer += total;
      } else if (
        mode === "split" ||
        mode === "cash+transfer" ||
        mode === "cash + transfer"
      ) {
        // Split advances are stored as separate cash/bank rows; ignore aggregate if any
      }
    }

    // Credit invoices approved today (left awaiting_credit_approval)
    const approvedCreditTodayRows = await db.sequelize.query(
      `SELECT
         COALESCE(SUM(sw.amount), 0) AS total,
         COUNT(*) AS cnt
       FROM sale_workflows sw
       WHERE sw.facility_id = :facilityId
         AND sw.payment_type IN ('credit')
         AND sw.status IN (
           'credit_approved',
           'invoice_separation',
           'final_invoice',
           'warehouse_picking',
           'dual_signature',
           'goods_released',
           'completed'
         )
         AND sw.amount > 0
         AND DATE(sw.updated_at) BETWEEN :histFrom AND :histTo
         ${
           branchId && branchId !== "all" && Number.isFinite(parseInt(branchId, 10))
             ? "AND sw.branch_id = :branchId"
             : ""
         }`,
      {
        replacements: todayReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );
    const approved_credit_today =
      Number(approvedCreditTodayRows?.[0]?.total) || 0;
    const approved_credit_count_today =
      Number(approvedCreditTodayRows?.[0]?.cnt) || 0;

    // Recent customer advances for Verification Points history (Cash / Transfer tabs)
    const advanceRows = await db.sequelize.query(
      `SELECT
         ce.entry_id,
         ce.receiptNo AS sale_code,
         ce.link_id AS link_id,
         ce.customerNo AS customer_no,
         COALESCE(c.fullname, ce.customerNo) AS customer_name,
         ce.mode_of_payment AS payment_type,
         ce.cost AS amount,
         ce.description,
         ce.created_at AS updated_at,
         ce.created_at AS createdAt
       FROM customer_entries ce
       LEFT JOIN customers c
         ON c.customerNo = ce.customerNo
        AND c.facilityId = ce.facilityId
       WHERE ce.facilityId = :facilityId
         AND ce.type = 'deposit'
         AND ce.cost > 0
         AND (
           ce.receiptNo LIKE 'AD-%'
           OR LOWER(ce.description) LIKE '%advance%'
           OR LOWER(ce.description) LIKE '%collection points advance%'
           OR LOWER(ce.description) LIKE '%verification points advance%'
         )
         AND (
           ce.description NOT LIKE 'Sale payment%'
         )
         AND DATE(ce.created_at) BETWEEN :histFrom AND :histTo
         ${branchClause}
       ORDER BY ce.created_at DESC
       LIMIT 300`,
      {
        replacements: todayReplacements,
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    const advance_history = (advanceRows || []).map((r) => {
      const mode = String(r.payment_type || "").toLowerCase().trim();
      const desc = String(r.description || "");
      const isDepositApply =
        mode === "advance" || /^advance applied/i.test(desc);
      let payment_type = "cash";
      if (isDepositApply) {
        payment_type = "deposit";
      } else if (
        mode === "bank" ||
        mode === "transfer" ||
        mode === "bank transfer" ||
        mode === "cheque"
      ) {
        payment_type = "transfer";
      } else if (
        mode === "split" ||
        mode === "cash+transfer" ||
        mode === "cash + transfer"
      ) {
        payment_type = "split";
      } else if (mode === "cash") {
        payment_type = "cash";
      }
      const invoiceRef = String(r.link_id || "").trim();
      return {
        id: `adv-${r.entry_id}`,
        sale_code: isDepositApply
          ? invoiceRef || r.sale_code || `AA-${r.entry_id}`
          : r.sale_code || `AD-${r.entry_id}`,
        customer_no: r.customer_no || "",
        customer_name: r.customer_name || "",
        payment_type,
        amount: Number(r.amount) || 0,
        status: isDepositApply ? "deposit_applied" : "customer_advance",
        status_label: isDepositApply ? "Deposit applied" : "Customer Deposit",
        kind: isDepositApply ? "deposit_applied" : "customer_advance",
        description: desc,
        updated_at: r.updated_at,
        createdAt: r.createdAt,
      };
    });

    let applied_deposit_today = 0;
    let applied_deposit_count_today = 0;
    for (const row of advance_history) {
      if (row.kind === "deposit_applied") {
        applied_deposit_today += Number(row.amount) || 0;
        applied_deposit_count_today += 1;
      }
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
      payment_type: ["cash", "transfer", "bank", "split", "credit", "credit_split", "deposit"],
    };
    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (Number.isFinite(bid) && bid > 0) historyWhere.branch_id = bid;
    }
    if (ct === "cash") historyWhere.payment_type = ["cash", "split", "credit_split"];
    else if (ct === "transfer")
      historyWhere.payment_type = ["transfer", "bank", "split", "credit_split"];
    else if (ct === "split") historyWhere.payment_type = ["split", "credit_split"];
    else if (ct === "credit") historyWhere.payment_type = ["credit"];
    else if (ct === "deposit") historyWhere.payment_type = ["deposit"];

    // History is always date-scoped (default: today)
    historyWhere.updated_at = {
      [Op.between]: [
        new Date(`${histFrom}T00:00:00.000`),
        new Date(`${histTo}T23:59:59.999`),
      ],
    };

    const history = await db.SaleWorkflow.findAll({
      where: historyWhere,
      order: [["updated_at", "DESC"]],
      limit: 500,
    });

    const workflowHistory = history.map((r) => {
      const plain = r.toJSON();
      return {
        ...plain,
        kind: "invoice",
        history: normalizeHistory(plain.history),
        status_label:
          SALE_WORKFLOW_STAGES.find((s) => s.id === plain.status)?.label ||
          plain.status,
        amount: Number(plain.amount) || 0,
      };
    });

    // Fully applied deposits store remaining due as 0 — show invoice total instead
    const depositZeroCodes = [
      ...new Set(
        workflowHistory
          .filter(
            (r) =>
              String(r.payment_type || "").toLowerCase() === "deposit" &&
              !(Number(r.amount) > 0.009) &&
              r.sale_code,
          )
          .map((r) => r.sale_code),
      ),
    ];
    if (depositZeroCodes.length) {
      const invRows = await db.sequelize.query(
        `SELECT invoice_ref, amount
         FROM invoices
         WHERE facility_id = :facilityId
           AND invoice_ref IN (:depositZeroCodes)`,
        {
          replacements: { facilityId, depositZeroCodes },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      const amtByRef = {};
      for (const row of invRows || []) {
        amtByRef[String(row.invoice_ref)] = Number(row.amount) || 0;
      }
      for (const row of workflowHistory) {
        if (
          String(row.payment_type || "").toLowerCase() === "deposit" &&
          !(Number(row.amount) > 0.009)
        ) {
          const invAmt = amtByRef[String(row.sale_code)] || 0;
          if (invAmt > 0) row.amount = invAmt;
        }
      }
    }

    const histDiscountMap = await loadDiscountBySaleCode(
      facilityId,
      workflowHistory.map((r) => r.sale_code).filter(Boolean),
    );
    workflowHistory.forEach((row) => applyDiscountMeta(row, histDiscountMap));

    const workflowSaleCodes = new Set(
      workflowHistory.map((r) => String(r.sale_code || "")).filter(Boolean),
    );
    const advanceHistoryDeduped = advance_history.filter((r) => {
      if (r.kind !== "deposit_applied") return true;
      return !workflowSaleCodes.has(String(r.sale_code || ""));
    });

    // Merge advances into history (newest first)
    const mergedHistory = [...workflowHistory, ...advanceHistoryDeduped].sort(
      (a, b) =>
        new Date(b.updated_at || b.createdAt || 0) -
        new Date(a.updated_at || a.createdAt || 0),
    );

    return res.json({
      success: true,
      results: {
        pending: pendingRows,
        credit_pending: creditRows,
        deposit_pending: depositRows,
        discount_pending: discountRows,
        mode_pending: modeRows,
        history: mergedHistory.slice(0, 120),
        advance_history,
        summary: {
          ...summary,
          collected_cash_today: collected_cash,
          collected_transfer_today: collected_transfer,
          collected_today: collected_cash + collected_transfer,
          approved_credit_today,
          approved_credit_count_today,
          applied_deposit_today,
          applied_deposit_count_today,
          history_from: histFrom,
          history_to: histTo,
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

    let collectorName =
      String(req.body.collector_name || req.body.updated_by_name || "").trim() ||
      null;
    if (!collectorName && updated_by && db.users) {
      try {
        const u = await db.users.findByPk(updated_by, {
          attributes: ["firstname", "lastname", "username"],
          transaction,
        });
        if (u) {
          collectorName =
            [u.firstname, u.lastname].filter(Boolean).join(" ").trim() ||
            u.username ||
            null;
        }
      } catch (_) {
        /* ignore */
      }
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
          "Credit invoices must be approved on the Credit tab at Verification Points — they cannot be collected as cash/transfer",
      });
    }
    if (paymentType === "deposit") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Deposit invoices must be settled on Apply Deposit — they cannot be collected as cash/transfer",
      });
    }
    // collection_side / cashier_type here is the active collection tab for this request
    // (Cash Collection vs Transfer Collection), not a user profile field.
    const ct = String(
      req.body.collection_side || cashier_type || "",
    )
      .toLowerCase()
      .trim();
    if (
      ct === "cash" &&
      paymentType !== "cash" &&
      !isSplitPaymentType(paymentType)
    ) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Use Cash Collection for cash invoices only",
      });
    }
    if (
      ct === "transfer" &&
      paymentType !== "transfer" &&
      paymentType !== "bank" &&
      !isSplitPaymentType(paymentType)
    ) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Use Transfer Collection for transfer invoices only",
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
    const isSplit = isSplitPaymentType(paymentType);
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

    // Prefer explicit side, else infer from submitted modes (cash-only → cash, etc.)
    let resolvedSide = collectionSide;
    if (resolvedSide !== "cash" && resolvedSide !== "transfer") {
      resolvedSide = inferCollectionSideFromSplits(rawSplits);
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

    if (isSplit) {
      // Cash + Transfer: part payment from either point is always allowed
      // (amount may be less than invoice total; advance when cash+transfer = due).
      if (resolvedSide === "cash" || resolvedSide === "transfer") {
        const sideModes =
          resolvedSide === "cash"
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
              resolvedSide === "cash"
                ? "Cash collection point must submit a cash amount"
                : "Transfer collection point must submit a transfer amount",
          });
        }
      }

      const remaining = Number(
        (amountDue - (progress.collected_total || 0)).toFixed(2),
      );
      if (remaining <= 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "This invoice is already fully collected",
        });
      }
      const paidNow = rawSplits.reduce(
        (sum, s) => sum + (Number(s.amount) || 0),
        0,
      );
      if (paidNow - remaining > 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Amount exceeds remaining balance (₦${remaining.toFixed(2)})`,
        });
      }
    } else {
      // Cash-only / transfer-only: full settlement in one step
      if (Math.abs(portionTotal - amountDue) > 0.05) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Payment total (${portionTotal}) must equal amount due (${amountDue})`,
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

      if (isSplit && (resolvedSide === "cash" || resolvedSide === "transfer")) {
        const side = resolvedSide === "cash" ? "cash" : "transfer";
        setWorkflowHistory(
          row,
          pushHistory(
            row.history,
            "awaiting_cashier_confirm",
            updated_by,
            `${side === "cash" ? "Cash" : "Transfer"} portion collected ₦${payAmt.toFixed(2)}${
              collectorName ? ` by ${collectorName}` : ""
            }`,
            {
              collection: {
                side,
                amount: payAmt,
                by_name: collectorName,
              },
            },
          ),
        );
      } else if (isSplit) {
        // Both modes in one submit — record each
        const side = mode === "cash" ? "cash" : "transfer";
        setWorkflowHistory(
          row,
          pushHistory(
            row.history,
            "awaiting_cashier_confirm",
            updated_by,
            `${side === "cash" ? "Cash" : "Transfer"} portion collected ₦${payAmt.toFixed(2)}${
              collectorName ? ` by ${collectorName}` : ""
            }`,
            {
              collection: {
                side,
                amount: payAmt,
                by_name: collectorName,
              },
            },
          ),
        );
      }
    }

    await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

    const updatedProgress = isSplit
      ? getSplitCollectionProgress(row.history)
      : null;
    const fullyPaid = isSplit
      ? !!(
          updatedProgress &&
          Math.abs(updatedProgress.collected_total - amountDue) <= 0.05
        )
      : true;

    if (fullyPaid) {
      row.status = "invoice_separation";
      row.hold_overnight = false;
      setWorkflowHistory(
        row,
        pushHistory(
          row.history,
          "payment_confirmed",
          updated_by,
          note ||
            (isSplit
              ? paymentType === "credit_split"
                ? "Cash + Transfer + Credit fully settled — ready for separation"
                : "Cash + Transfer fully collected — ready for separation"
              : `Payment collected by cashier (${rawSplits
                  .map((s) => `${s.mode}:${s.amount}`)
                  .join(", ")})`),
        ),
      );
      setWorkflowHistory(
        row,
        pushHistory(
          row.history,
          "invoice_separation",
          updated_by,
          "Ready for invoice separation by branch",
        ),
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

      try {
        const { notifyBusinessMembers } = require("../services/notifications");
        void notifyBusinessMembers({
          facilityId,
          excludeUserId: updated_by,
          actorUserId: updated_by,
          type: "payment_collected",
          title: `Payment collected for ${saleRef}`,
          body: row.customer_name
            ? `${row.customer_name} — ready for separation`
            : "Ready for invoice separation",
          link: "/app/payments/verification-points",
          entityType: "invoice",
          entityId: saleRef,
        });
      } catch (notifErr) {
        console.warn("Payment notification skipped:", notifErr?.message || notifErr);
      }

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

    // Partial split — stay at collection points until cash + transfer cover amount due
    row.updated_by = updated_by || row.updated_by;
    await row.save({ transaction });
    await transaction.commit();

    const rem = Number(
      (amountDue - (updatedProgress?.collected_total || 0)).toFixed(2),
    );
    const sideLabel =
      resolvedSide === "transfer"
        ? "Transfer"
        : resolvedSide === "cash"
          ? "Cash"
          : "Payment";

    try {
      const { notifyBusinessMembers } = require("../services/notifications");
      void notifyBusinessMembers({
        facilityId,
        excludeUserId: updated_by,
        actorUserId: updated_by,
        type: "payment_collected",
        title: `${sideLabel} recorded for ${saleRef}`,
        body: `Remaining ₦${rem.toFixed(2)}${
          row.customer_name ? ` — ${row.customer_name}` : ""
        }`,
        link: "/app/payments/verification-points",
        entityType: "invoice",
        entityId: saleRef,
      });
    } catch (notifErr) {
      console.warn("Payment notification skipped:", notifErr?.message || notifErr);
    }

    return res.json({
      success: true,
      message: `${sideLabel} portion recorded for ${saleRef}. Remaining ₦${rem.toFixed(2)} — collect from Cash and/or Transfer${
        paymentType === "credit_split"
          ? ", or send the remainder to Credit Approval"
          : ""
      }.`,
      results: {
        ...row.toJSON(),
        status_color: stageMeta(row.status)?.color || "amber",
        next_status: nextStageFor(row.status, row.payment_type),
        split_progress: updatedProgress,
        partial: true,
        remaining: rem,
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

/**
 * Credit + Cash + Transfer: after (optional) partial cash/transfer collection,
 * send the unpaid remainder to Credit Approval.
 */
exports.sendCreditRemainder = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      saleCode,
      updated_by,
      note,
    } = req.body || {};

    if (!facilityId || !saleCode) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and saleCode are required",
      });
    }
    if (!db.SaleWorkflow) {
      await transaction.rollback();
      return res.status(500).json({
        success: false,
        message: "SaleWorkflow model not loaded",
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

    const paymentType = String(row.payment_type || "").toLowerCase();
    if (paymentType !== "credit_split") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Only Credit + Cash + Transfer invoices can send a remainder to credit",
      });
    }
    if (row.status !== "awaiting_cashier_confirm") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Invoice is not awaiting collection (status: ${row.status})`,
      });
    }

    const amountDue = Number(row.amount) || 0;
    const progress = getSplitCollectionProgress(row.history);
    const remaining = Number(
      (amountDue - (progress.collected_total || 0)).toFixed(2),
    );
    if (remaining <= 0.05) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Nothing left on credit — cash/transfer already covers the invoice",
      });
    }

    const limitErr = await assertCreditLimitMessage(
      facilityId,
      row.customer_no,
      {
        extraAmount: remaining,
        excludeInvoiceRef: row.sale_code,
      },
    );
    if (limitErr) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: limitErr,
      });
    }

    row.amount = remaining;
    row.payment_type = "credit";
    row.status = "awaiting_credit_approval";
    row.updated_by = updated_by || row.updated_by;
    const cashCollected = progress.cash || 0;
    const transferCollected = progress.transfer || 0;
    const noteText =
      cashCollected <= 0.05 && transferCollected <= 0.05
        ? `Full amount ₦${remaining.toFixed(2)} confirmed as Credit — awaiting Credit Approval`
        : `Cash ₦${cashCollected.toFixed(2)} + Transfer ₦${transferCollected.toFixed(2)} collected; Credit ₦${remaining.toFixed(2)} sent to Credit Approval`;
    setWorkflowHistory(
      row,
      pushHistory(
        row.history,
        "awaiting_credit_approval",
        updated_by,
        note || noteText,
        {
          credit_remainder: {
            from: "credit_split",
            original_amount: amountDue,
            cash_collected: cashCollected,
            transfer_collected: transferCollected,
            remainder: remaining,
            credit: remaining,
          },
        },
      ),
    );
    await row.save({ transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message:
        cashCollected <= 0.05 && transferCollected <= 0.05
          ? `₦${remaining.toFixed(2)} confirmed as Credit for ${saleCode} — approve on Credit tab`
          : `Credit ₦${remaining.toFixed(2)} sent to Credit Approval for ${saleCode}`,
      results: {
        ...row.toJSON(),
        status_color: stageMeta(row.status)?.color || "amber",
        next_status: nextStageFor(row.status, row.payment_type),
        split_progress: {
          ...progress,
          credit: remaining,
          original_amount: amountDue,
        },
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("sendCreditRemainder:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to send credit remainder",
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
      row.status !== "credit_approved" &&
      row.status !== "invoice_separation" &&
      row.status !== "final_invoice" &&
      !normalizeHistory(row.history).some(
        (h) => String(h?.status || "") === "credit_approved",
      )
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Credit approval is required at Verification Points before Invoice Separation",
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

const SPECIAL_TREATMENT_TYPES = [
  "cash",
  "transfer",
  "split",
  "credit",
  "credit_split",
  "deposit",
  "warehouse",
];

/**
 * Switch payment mode on a sale (Verification Points / special treatment).
 * When requireApproval is true, queues awaiting_payment_mode_approval instead of applying.
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
      requireApproval = false,
    } = req.body;

    const paymentType = normalizeSpecialPaymentType(rawType);

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
        message:
          "paymentType must be cash, transfer, split, credit, credit_split, deposit, or warehouse",
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

    const updated = [];
    for (const row of rows) {
      const prevType = String(row.payment_type || "").toLowerCase();
      if (prevType === paymentType && !requireApproval) {
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          changed: false,
        });
        continue;
      }

      if (
        [
          "warehouse_picking",
          "dual_signature",
          "goods_released",
          "completed",
        ].includes(String(row.status || ""))
      ) {
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          changed: false,
          skipped: true,
          reason: "Sale already in fulfillment",
        });
        continue;
      }

      if (requireApproval) {
        if (prevType === paymentType) {
          updated.push({
            sale_code: row.sale_code,
            payment_type: row.payment_type,
            status: row.status,
            changed: false,
          });
          continue;
        }
        if (row.status === "awaiting_payment_mode_approval") {
          const existing = getPendingPaymentMode(row.history);
          if (existing?.to === paymentType) {
            updated.push({
              sale_code: row.sale_code,
              payment_type: row.payment_type,
              status: row.status,
              proposed_payment_type: paymentType,
              changed: false,
            });
            continue;
          }
        }

        const previousStatus =
          row.status === "awaiting_payment_mode_approval"
            ? getPendingPaymentMode(row.history)?.previous_status ||
              "awaiting_cashier_confirm"
            : row.status;

        row.history = pushHistory(
          row.history,
          "awaiting_payment_mode_approval",
          updated_by,
          note ||
            `Payment mode switch requested: ${prevType || "—"} → ${paymentType}`,
          {
            pending_payment_mode: {
              from: prevType,
              to: paymentType,
              previous_status: previousStatus,
            },
          },
        );
        row.status = "awaiting_payment_mode_approval";
        row.updated_by = updated_by || row.updated_by;
        await row.save({ transaction });
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          proposed_payment_type: paymentType,
          changed: true,
          pending_approval: true,
        });
        continue;
      }

      const applied = await applyPaymentTypeToWorkflow(
        row,
        {
          facilityId,
          paymentType,
          updated_by,
          note,
        },
        transaction,
      );
      if (applied.skipped) {
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          changed: false,
          skipped: true,
          reason: applied.reason,
        });
        continue;
      }
      if (!applied.changed) {
        updated.push({
          sale_code: row.sale_code,
          payment_type: row.payment_type,
          status: row.status,
          changed: false,
        });
        continue;
      }
      await row.save({ transaction });
      updated.push({
        sale_code: row.sale_code,
        payment_type: row.payment_type,
        status: row.status,
        changed: true,
      });
    }

    await transaction.commit();
    const pendingCount = updated.filter((u) => u.pending_approval).length;
    const appliedCount = updated.filter(
      (u) => u.changed && !u.pending_approval,
    ).length;
    return res.json({
      success: true,
      message: requireApproval
        ? pendingCount
          ? `Submitted ${pendingCount} payment mode switch(es) for approval`
          : "No payment mode changes submitted"
        : `Updated ${appliedCount} invoice(s) to ${paymentType}`,
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
