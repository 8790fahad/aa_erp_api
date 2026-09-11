"use strict";

const { QueryTypes } = require("sequelize");
const db = require("../models");
const { notifyWorkflowPosting } = require("./workflowMail");

const REMINDER_THRESHOLDS = [50, 75, 100];
const REBATE_NEXT = {
  moduleTitles: ["Rebate Ledger"],
  nextLabel: "Rebate Ledger",
  actionPath: "/app/sales/rebate",
  actionVerb: "review",
};

function asDateOnly(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch (_) {
    return String(value).slice(0, 10);
  }
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productFilter(rule, replacements) {
  const sku = String(rule.product_sku || "").trim();
  const name = String(rule.product_name || "").trim();
  if (sku.startsWith("cat:")) {
    replacements.catName = sku.slice(4);
    return `LOWER(TRIM(COALESCE(p.category, ''))) = LOWER(TRIM(:catName))`;
  }
  if (sku) {
    replacements.productSku = sku;
    return `(p.sku = :productSku OR se.product_id = :productSku)`;
  }
  if (name && name !== "All products") {
    replacements.productName = name;
    return `LOWER(TRIM(COALESCE(p.name, se.product_id, ''))) = LOWER(TRIM(:productName))`;
  }
  return "1=1";
}

function partyMatchesFilter(rule, { partyNo, partyName }) {
  const no = String(partyNo || "").trim();
  const name = String(partyName || "").trim();
  if (!no && !name) return true;
  const basis = String(rule.basis || "sales").toLowerCase();
  if (basis === "purchase") {
    const ruleNo = String(rule.supplier_no || "").trim();
    const ruleName = String(rule.supplier_name || "").trim();
    if (no && ruleNo) return no === ruleNo;
    if (name && ruleName) return name.toLowerCase() === ruleName.toLowerCase();
    return !ruleNo && !ruleName;
  }
  const ruleNo = String(rule.customer_no || "").trim();
  const ruleName = String(rule.customer_name || "").trim();
  if (no && ruleNo) return no === ruleNo;
  if (name && ruleName) return name.toLowerCase() === ruleName.toLowerCase();
  return !ruleNo && !ruleName;
}

async function sumSalesForRule(facilityId, rule) {
  const replacements = {
    facilityId: String(facilityId),
    fromDate: asDateOnly(rule.from_date),
    toDate: asDateOnly(rule.to_date),
    customerNo: String(rule.customer_no || "").trim(),
    customerName: String(rule.customer_name || "").trim(),
  };
  const productSql = productFilter(rule, replacements);
  let partySql = "1=1";
  if (replacements.customerNo) {
    partySql = `(i.ref_number = :customerNo OR c.customerNo = :customerNo)`;
  } else if (replacements.customerName) {
    partySql = `(
      LOWER(TRIM(COALESCE(c.fullname, ''))) = LOWER(TRIM(:customerName))
      OR LOWER(TRIM(COALESCE(c.company_name, ''))) = LOWER(TRIM(:customerName))
    )`;
  }

  const rows = await db.sequelize.query(
    `SELECT
       COALESCE(
         NULLIF(TRIM(c.fullname), ''),
         NULLIF(TRIM(c.company_name), ''),
         :customerName
       ) AS party_name,
       COALESCE(NULLIF(TRIM(c.customerNo), ''), :customerNo) AS party_no,
       SUM(se.qty_out) AS total_qty,
       SUM(se.qty_out * COALESCE(NULLIF(se.selling_price, 0), se.cost_price, 0)) AS total_value
     FROM store_entries se
     LEFT JOIN invoices i
       ON i.facility_id = se.facilityId
      AND i.type = 'sales'
      AND i.invoice_ref = se.reference_number
     LEFT JOIN customers c
       ON c.facilityId = se.facilityId
      AND c.customerNo = COALESCE(i.ref_number, :customerNo)
     LEFT JOIN products p
       ON p.facility_id = se.facilityId
      AND p.sku = se.product_id
     WHERE se.facilityId = :facilityId
       AND se.qty_out > 0
       AND DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date))
           BETWEEN :fromDate AND :toDate
       AND ${partySql}
       AND ${productSql}`,
    { replacements, type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

async function sumPurchaseForRule(facilityId, rule) {
  const replacements = {
    facilityId: String(facilityId),
    fromDate: asDateOnly(rule.from_date),
    toDate: asDateOnly(rule.to_date),
    supplierNo: String(rule.supplier_no || "").trim(),
    supplierName: String(rule.supplier_name || "").trim(),
  };
  const productSql = productFilter(rule, replacements);
  let partySql = "1=1";
  if (replacements.supplierNo) {
    partySql = `(i.ref_number = :supplierNo OR se.supplier_code = :supplierNo OR s.supplier_number = :supplierNo)`;
  } else if (replacements.supplierName) {
    partySql = `LOWER(TRIM(COALESCE(s.supplier_name, ''))) = LOWER(TRIM(:supplierName))`;
  }

  const rows = await db.sequelize.query(
    `SELECT
       COALESCE(
         NULLIF(TRIM(s.supplier_name), ''),
         :supplierName
       ) AS party_name,
       COALESCE(
         NULLIF(TRIM(s.supplier_number), ''),
         NULLIF(TRIM(i.ref_number), ''),
         NULLIF(TRIM(se.supplier_code), ''),
         :supplierNo
       ) AS party_no,
       SUM(se.qty_in) AS total_qty,
       SUM(se.qty_in * COALESCE(NULLIF(se.cost_price, 0), se.selling_price, 0)) AS total_value
     FROM store_entries se
     LEFT JOIN invoices i
       ON i.facility_id = se.facilityId
      AND i.type = 'purchase'
      AND i.invoice_ref = se.reference_number
     LEFT JOIN suppliersinfo s
       ON s.facilityId = se.facilityId
      AND s.supplier_number = COALESCE(i.ref_number, se.supplier_code, :supplierNo)
     LEFT JOIN products p
       ON p.facility_id = se.facilityId
      AND p.sku = se.product_id
     WHERE se.facilityId = :facilityId
       AND se.qty_in > 0
       AND DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date))
           BETWEEN :fromDate AND :toDate
       AND ${partySql}
       AND ${productSql}`,
    { replacements, type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

function progressFor(totalQty, minQty) {
  const qty = Number(totalQty) || 0;
  const min = Number(minQty) || 0;
  if (min <= 0) return qty > 0 ? 100 : 0;
  return Math.min(100, (qty / min) * 100);
}

function highestReached(progress) {
  let reached = 0;
  for (const threshold of REMINDER_THRESHOLDS) {
    if (progress + 0.0001 >= threshold) reached = threshold;
  }
  return reached;
}

async function markAndNotify({
  facilityId,
  rule,
  partyName,
  partyNo,
  totalQty,
  totalValue,
  progress,
  threshold,
  actorUserId,
}) {
  const minQty = Number(rule.min_qty) || 0;
  const rebatePct = Number(rule.rebate_percent) || 0;
  const qualifies = progress >= 100;
  const rebateAmount = qualifies
    ? Number(totalValue || 0) * (rebatePct / 100)
    : 0;
  const unitValue =
    Number(totalQty) > 0 ? Number(totalValue || 0) / Number(totalQty) : 0;
  const projected =
    unitValue > 0
      ? unitValue * minQty * (rebatePct / 100)
      : Number(totalValue || 0) * (rebatePct / 100);
  const qtyRemaining = Math.max(0, minQty - Number(totalQty || 0));
  const name = String(partyName || rule.customer_name || rule.supplier_name || "Party").trim();
  if (!name) return false;

  const [row] = await db.RebateStatus.findOrCreate({
    where: {
      facility_id: String(facilityId),
      rule_id: Number(rule.id),
      customer_name: name,
    },
      defaults: {
        customer_no: partyNo ? String(partyNo) : null,
        status: "pending",
        payout_type: "credit",
      },
  });

  if (String(row.status || "").toLowerCase() === "paid") return false;
  const already = Number(row.last_reminder_pct || 0);
  if (already >= threshold) return false;

  const eventLabel =
    threshold >= 100 ? "qualified" : `${threshold}% reminder`;
  const amountLabel = qualifies
    ? formatAmount(rebateAmount)
    : formatAmount(projected);

  await notifyWorkflowPosting({
    facilityId,
    actorUserId: actorUserId || rule.created_by,
    documentId: `${name} · ${rule.name}`,
    documentType: "Rebate",
    eventLabel,
    extraUserIds: rule.created_by ? [rule.created_by] : [],
    nextStep: {
      ...REBATE_NEXT,
      actionVerb: qualifies ? "issue" : "review",
    },
    inAppType: "rebate_reminder",
    actorIntro: qualifies
      ? `<strong>${escapeHtml(name)}</strong> has reached the volume target for <strong>${escapeHtml(rule.name)}</strong>. Rebate is <strong>${rebatePct}%</strong> — please issue it from Rebate Ledger.`
      : `<strong>${escapeHtml(name)}</strong> is at <strong>${Math.round(progress)}%</strong> of the volume target for <strong>${escapeHtml(rule.name)}</strong>. Rebate will be <strong>${rebatePct}%</strong> once the minimum quantity is met.`,
    nextIntro: qualifies
      ? `<strong>${escapeHtml(name)}</strong> qualified for a <strong>${rebatePct}%</strong> rebate on <strong>${escapeHtml(rule.name)}</strong>. Please issue the credit or payment in Rebate Ledger.`
      : `Rebate progress reminder: <strong>${escapeHtml(name)}</strong> is at <strong>${Math.round(progress)}%</strong> (${threshold}% checkpoint) of <strong>${escapeHtml(rule.name)}</strong>. Rebate is <strong>${rebatePct}%</strong> at target.`,
    details: [
      ["Rule", rule.name],
      ["Party", name],
      ["Basis", rule.basis === "purchase" ? "Purchase" : "Sales"],
      ["Period", rule.period_label],
      ["Applies to", rule.product_name || "All products"],
      ["Progress", `${Math.round(progress)}% (${formatAmount(totalQty).replace(/\.00$/, "")} / ${formatAmount(minQty).replace(/\.00$/, "")} units)`],
      ["Rebate %", `${rebatePct}%`],
      [
        qualifies ? "Rebate due" : "Estimated rebate",
        amountLabel,
      ],
      qualifies
        ? ["Status", "Target reached — ready to issue"]
        : ["Still needed", `${formatAmount(qtyRemaining).replace(/\.00$/, "")} more units`],
    ],
    remark: qualifies
      ? `Target reached at ${rebatePct}% rebate. Open Rebate Ledger to issue the credit or payment.`
      : `${name} is at ${Math.round(progress)}% of the volume target. Reminder sent at ${threshold}%. Rebate is ${rebatePct}% once the minimum quantity is met.`,
  });

  const patch = {
    last_reminder_pct: threshold,
    customer_no: partyNo ? String(partyNo) : row.customer_no,
  };
  try {
    await row.update(patch);
  } catch (err) {
    if (!/last_reminder_pct/i.test(String(err?.message || ""))) {
      console.warn("[rebateReminders] status update failed:", err?.message || err);
    }
  }
  return true;
}

/**
 * Send rebate-progress reminder emails at 50%, 75% and 100% of min qty.
 * Includes the rule's rebate percentage so staff know what will be paid.
 */
async function evaluateRebateReminders({
  facilityId,
  basis = null,
  partyNo = null,
  partyName = null,
  actorUserId = null,
} = {}) {
  try {
    if (!facilityId || !db.RebateRule) return { sent: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const where = { facility_id: String(facilityId) };
    const rules = await db.RebateRule.findAll({ where });
    const active = (rules || []).filter((row) => {
      const from = asDateOnly(row.from_date);
      const to = asDateOnly(row.to_date);
      if (from && today < from) return false;
      if (to && today > to) return false;
      if (basis && String(row.basis || "sales") !== String(basis)) return false;
      return partyMatchesFilter(row, { partyNo, partyName });
    });
    if (!active.length) return { sent: 0 };

    let sent = 0;
    for (const rule of active) {
      const isPurchase = String(rule.basis || "sales") === "purchase";
      const totals = isPurchase
        ? await sumPurchaseForRule(facilityId, rule)
        : await sumSalesForRule(facilityId, rule);
      const totalQty = Number(totals?.total_qty || 0);
      if (totalQty <= 0) continue;
      const progress = progressFor(totalQty, rule.min_qty);
      const threshold = highestReached(progress);
      if (!threshold) continue;

      const party = String(
        totals?.party_name ||
          (isPurchase ? rule.supplier_name : rule.customer_name) ||
          partyName ||
          "",
      ).trim();
      const notified = await markAndNotify({
        facilityId,
        rule,
        partyName: party,
        partyNo: totals?.party_no || partyNo,
        totalQty,
        totalValue: Number(totals?.total_value || 0),
        progress,
        threshold,
        actorUserId,
      });
      if (notified) sent += 1;
    }
    return { sent };
  } catch (err) {
    console.warn("[rebateReminders] evaluate failed:", err?.message || err);
    return { sent: 0, error: err?.message || String(err) };
  }
}

async function runRebateRemindersForAllFacilities() {
  if (!db.RebateRule) return { facilities: 0, sent: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.sequelize.query(
    `SELECT DISTINCT facility_id
     FROM rebate_rules
     WHERE :today BETWEEN from_date AND to_date`,
    { replacements: { today }, type: QueryTypes.SELECT },
  );
  let sent = 0;
  for (const row of rows || []) {
    const result = await evaluateRebateReminders({
      facilityId: row.facility_id,
      actorUserId: "system",
    });
    sent += Number(result?.sent || 0);
  }
  return { facilities: (rows || []).length, sent };
}

module.exports = {
  evaluateRebateReminders,
  runRebateRemindersForAllFacilities,
  REMINDER_THRESHOLDS,
};
