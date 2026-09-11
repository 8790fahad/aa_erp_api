"use strict";

const { QueryTypes } = require("sequelize");
const moment = require("moment");
const db = require("../models");
const { notifyWorkflowPosting } = require("./workflowMail");
const { getNowPartsInTimezone } = require("./invoiceClosingService");

const TZ = "Africa/Lagos";
const DEADLINE_DAY = 22;
const REMINDER_DAY = 21;

const VAT_NEXT = {
  moduleTitles: [
    "Output VAT",
    "Input VAT",
    "VAT Report",
    "Settings VAT",
    "Settings VAT Policy",
  ],
  nextLabel: "Output VAT",
  actionPath: "/app/sales/vat-report",
  actionVerb: "file and pay",
};

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function previousMonthBounds(localDate) {
  const now = moment(localDate, "YYYY-MM-DD");
  const period = now.clone().subtract(1, "month");
  return {
    year: period.year(),
    month: period.month() + 1,
    label: period.format("MMMM YYYY"),
    fromDate: period.clone().startOf("month").format("YYYY-MM-DD"),
    toDate: period.clone().endOf("month").format("YYYY-MM-DD"),
    dueMonthKey: now.format("YYYY-MM"),
    deadlineDate: now.clone().date(DEADLINE_DAY).format("YYYY-MM-DD"),
    deadlineLabel: now.clone().date(DEADLINE_DAY).format("D MMMM YYYY"),
  };
}

/**
 * Input VAT = debits, Output VAT = credits on the VAT Recoverable head.
 */
async function computeVatHeadPosition({
  facilityId,
  head,
  fromDate,
  toDate,
} = {}) {
  const fromDateStr = fromDate
    ? moment(fromDate).format("YYYY-MM-DD")
    : moment().startOf("month").format("YYYY-MM-DD");
  const toDateStr = toDate
    ? moment(toDate).format("YYYY-MM-DD")
    : moment().format("YYYY-MM-DD");

  if (!facilityId) {
    return {
      head: "",
      description: "",
      fromDate: fromDateStr,
      toDate: toDateStr,
      input_vat: 0,
      output_vat: 0,
      net: 0,
      amount_to_pay: 0,
      recoverable: 0,
      line_count: 0,
    };
  }

  let vatHead = String(head || "").trim();
  if (!vatHead) {
    const business = await db.business.findOne({
      where: { id: String(facilityId) },
      attributes: ["vat_account_code"],
      raw: true,
    });
    vatHead = String(business?.vat_account_code || "").trim();
  }

  if (!vatHead) {
    return {
      head: "",
      description: "",
      fromDate: fromDateStr,
      toDate: toDateStr,
      input_vat: 0,
      output_vat: 0,
      net: 0,
      amount_to_pay: 0,
      recoverable: 0,
      line_count: 0,
    };
  }

  const account = await db.AccountCategory.findOne({
    where: { code: vatHead, facilityId: String(facilityId) },
    attributes: ["code", "description"],
    raw: true,
  });

  const totals = await db.sequelize.query(
    `SELECT
       COALESCE(SUM(gl.dr), 0) AS input_vat,
       COALESCE(SUM(gl.cr), 0) AS output_vat,
       COUNT(*) AS line_count
     FROM general_ledger gl
     WHERE (
         gl.facility_id = :facilityId
         OR CONVERT(gl.facility_id USING utf8mb4) = CONVERT(:facilityId USING utf8mb4)
       )
       AND TRIM(gl.account_code) = TRIM(:head)
       AND DATE(gl.transaction_date) >= :fromDate
       AND DATE(gl.transaction_date) <= :toDate`,
    {
      replacements: {
        facilityId: String(facilityId),
        head: vatHead,
        fromDate: fromDateStr,
        toDate: toDateStr,
      },
      type: QueryTypes.SELECT,
    },
  );

  const inputVat = parseFloat(totals[0]?.input_vat || 0) || 0;
  const outputVat = parseFloat(totals[0]?.output_vat || 0) || 0;
  const net = Number((outputVat - inputVat).toFixed(2));

  return {
    head: vatHead,
    description: account?.description || "VAT Recoverable",
    fromDate: fromDateStr,
    toDate: toDateStr,
    input_vat: Number(inputVat.toFixed(2)),
    output_vat: Number(outputVat.toFixed(2)),
    net,
    amount_to_pay: net > 0.005 ? net : 0,
    recoverable: net < -0.005 ? Math.abs(net) : 0,
    line_count: parseInt(totals[0]?.line_count || 0, 10),
  };
}

async function notifyFacilityVatPayment(business, localDate) {
  const facilityId = business.id;
  const period = previousMonthBounds(localDate);
  const lastSent = String(business.vat_payment_reminder_last_sent || "").trim();
  if (lastSent === period.dueMonthKey) {
    return { skipped: true, reason: "already_sent" };
  }

  const position = await computeVatHeadPosition({
    facilityId,
    head: business.vat_account_code,
    fromDate: period.fromDate,
    toDate: period.toDate,
  });

  if (!position.head) {
    return { skipped: true, reason: "no_vat_account" };
  }

  console.log(
    `[vat-payment-reminder] ${facilityId} head=${position.head} ${period.fromDate}..${period.toDate} input=${position.input_vat} output=${position.output_vat} pay=${position.amount_to_pay}`,
  );

  const payable = position.amount_to_pay > 0.005;
  const credit = position.recoverable > 0.005;
  const actionPath = `/app/sales/vat-report?fromDate=${encodeURIComponent(
    period.fromDate,
  )}&toDate=${encodeURIComponent(period.toDate)}`;

  await notifyWorkflowPosting({
    facilityId,
    actorUserId: business.business_admin || null,
    documentId: period.label,
    documentType: "VAT return",
    eventLabel: "reminder",
    inAppType: "vat_payment_reminder",
    nextStep: {
      ...VAT_NEXT,
      actionPath,
      actionVerb: payable ? "pay" : "review",
      nextLabel: "Output VAT",
    },
    actorIntro: payable
      ? `VAT for <strong>${period.label}</strong> is payable. The filing / payment deadline is <strong>${period.deadlineLabel}</strong> (tomorrow). Amount due: <strong>₦${formatAmount(position.amount_to_pay)}</strong>.`
      : credit
        ? `VAT for <strong>${period.label}</strong> is a recoverable credit of <strong>₦${formatAmount(position.recoverable)}</strong>. The return deadline is still <strong>${period.deadlineLabel}</strong>.`
        : `VAT for <strong>${period.label}</strong> nets to zero. The return deadline is <strong>${period.deadlineLabel}</strong>.`,
    nextIntro: payable
      ? `VAT payment reminder: <strong>${period.label}</strong> is due by <strong>${period.deadlineLabel}</strong>. Output VAT less Input VAT is <strong>₦${formatAmount(position.amount_to_pay)}</strong> payable.`
      : credit
        ? `VAT reminder: <strong>${period.label}</strong> shows a recoverable credit of <strong>₦${formatAmount(position.recoverable)}</strong>. Deadline <strong>${period.deadlineLabel}</strong>.`
        : `VAT reminder: <strong>${period.label}</strong> nets to zero. Deadline <strong>${period.deadlineLabel}</strong>.`,
    details: [
      ["Period", period.label],
      ["From", period.fromDate],
      ["To", period.toDate],
      ["VAT head", `${position.head} · ${position.description}`],
      ["Input VAT", `₦${formatAmount(position.input_vat)}`],
      ["Output VAT", `₦${formatAmount(position.output_vat)}`],
      payable
        ? ["Amount to pay", `₦${formatAmount(position.amount_to_pay)}`]
        : credit
          ? ["Recoverable credit", `₦${formatAmount(position.recoverable)}`]
          : ["Net", "₦0.00"],
      ["Deadline", `${period.deadlineLabel} (22nd)`],
    ],
    remark:
      "This reminder is sent on the 21st so VAT can be filed and paid before the 22nd deadline.",
  });

  await markSent(facilityId, period.dueMonthKey);
  return {
    sent: true,
    period: period.label,
    amount_to_pay: position.amount_to_pay,
    recoverable: position.recoverable,
  };
}

async function markSent(facilityId, dueMonthKey) {
  try {
    await db.business.update(
      { vat_payment_reminder_last_sent: dueMonthKey },
      { where: { id: String(facilityId) } },
    );
  } catch (err) {
    if (!/vat_payment_reminder_last_sent/i.test(String(err?.message || ""))) {
      console.warn(
        "[vat-payment-reminder] mark sent failed:",
        err?.message || err,
      );
    }
  }
}

async function runVatPaymentReminders(now = new Date()) {
  const parts = getNowPartsInTimezone(TZ, now);
  const local = moment(parts.date, "YYYY-MM-DD");
  if (local.date() !== REMINDER_DAY) {
    return { skipped: true, reason: "not_reminder_day", day: local.date() };
  }

  const businesses = await db.business.findAll({
    attributes: [
      "id",
      "business_name",
      "vat_account_code",
      "business_admin",
      "vat_payment_reminder_last_sent",
    ],
  });

  let sent = 0;
  let skipped = 0;
  for (const business of businesses || []) {
    try {
      const result = await notifyFacilityVatPayment(business, parts.date);
      if (result?.sent) sent += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.error(
        `[vat-payment-reminder] Failed for ${business.id}:`,
        err?.message || err,
      );
    }
  }
  return { facilities: (businesses || []).length, sent, skipped };
}

module.exports = {
  computeVatHeadPosition,
  runVatPaymentReminders,
  notifyFacilityVatPayment,
  previousMonthBounds,
  REMINDER_DAY,
  DEADLINE_DAY,
};
